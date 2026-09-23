import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts, instances } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import type { ProbeKey } from "@/lib/probe";
import { redactQuiet } from "@/lib/secret-redactor";
import { startSshStream } from "@/lib/ssh-exec-stream";
import { CodaiClient, ENROLLED_STATES, type CodaiEnvironment } from "./client";
import { buildInstallCommand, redactInstallCommand } from "./install-command";
import { getCodaiLink, updateCodaiLinkStatus, upsertCodaiLink } from "./links";
import { getCodaiSettingsSecret } from "./settings";

export interface ProvisionInput {
  instanceId: string;
  projectId?: string;
  projectName?: string;
  environmentName: string;
}

export type ProvisionEvent =
  | { type: "step"; step: ProvisionStep; message: string }
  | { type: "line"; text: string }
  | { type: "done"; environmentId: string; projectId: string; slug: string; state: string }
  | { type: "error"; message: string };

export type ProvisionStep = "project" | "environment" | "token" | "install" | "poll";

export interface ProvisionResult {
  environmentId: string;
  projectId: string;
  slug: string;
  state: string;
  installExitCode: number | null;
  /** The command that ran, token redacted — safe to log. */
  command: string;
}

const POLL_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 5_000;
const INSTALL_TIMEOUT_MS = 6 * 60_000;

function defaultUser(platform: string, provider: string): string {
  if (platform === "macos") return "ec2-user";
  switch (provider) {
    case "azure":
      return "azureuser";
    case "digitalocean":
    case "hetzner":
    case "scaleway":
      return "root";
    default:
      return "ubuntu";
  }
}

interface SshTarget {
  host: string;
  port: number;
  user: string;
  key: ProbeKey;
}

/** Same resolution as `lib/containers.ts`: the account's probe key + the instance's public address. */
export async function loadCodaiSshTarget(instanceId: string): Promise<{ target: SshTarget; name: string }> {
  const inst = await db.query.instances.findFirst({ where: eq(instances.id, instanceId) });
  if (!inst) throw new Error("Instance not found");
  if (inst.platform === "windows") throw new Error("codaid's installer needs a Linux or macOS guest");
  if (!inst.publicIp && !inst.publicDns) throw new Error("Instance has no public IP/DNS");
  const acc = await db.query.cloudAccounts.findFirst({ where: eq(cloudAccounts.id, inst.accountId) });
  if (!acc?.probeKeyEnc) throw new Error("No probe SSH key on this account — upload one under the account's settings");
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  return {
    name: inst.displayName ?? inst.name ?? inst.providerInstanceId,
    target: {
      host: inst.publicIp ?? inst.publicDns!,
      port: 22,
      user: key.defaultUser ?? defaultUser(inst.platform, inst.provider),
      key,
    },
  };
}

function runInstall(target: SshTarget, command: string, onLine: (text: string) => void): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    let buf = "";
    let settled = false;
    let exit: number | null = null;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (buf.trim()) onLine(redactQuiet(buf));
      if (err) reject(err);
      else resolve(exit);
    };
    const handle = startSshStream({
      ...target,
      // ssh2 exec already runs through the login shell; `$?` after the pipe is `sh`'s exit.
      command: `${command}; echo __CODAI_EXIT__=$?`,
      onChunk: (text) => {
        buf += text;
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() ?? "";
        for (const raw of parts) {
          const m = /__CODAI_EXIT__=(\d+)/.exec(raw);
          if (m) {
            exit = Number(m[1]);
            continue;
          }
          if (raw.length) onLine(redactQuiet(raw));
        }
      },
      onError: (message) => finish(new Error(message)),
      onClose: () => finish(),
    });
    const timer = setTimeout(() => {
      handle.stop();
      finish(new Error(`install timed out after ${INSTALL_TIMEOUT_MS / 1000}s`));
    }, INSTALL_TIMEOUT_MS);
  });
}

async function pollUntilEnrolled(client: CodaiClient, environmentId: string, onTick: (env: CodaiEnvironment) => void, signal?: AbortSignal): Promise<CodaiEnvironment> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = await client.getEnvironment(environmentId);
  onTick(last);
  while (!ENROLLED_STATES.has(last.state) && last.state !== "error" && Date.now() < deadline && !signal?.aborted) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    last = await client.getEnvironment(environmentId);
    onTick(last);
  }
  return last;
}

/**
 * Turn a vmui-managed VM into a codai BYO Environment: ensure project → create
 * environment → mint a one-time enrol token → run the codaid installer over
 * SSH (streamed) → poll until enrolled (≤ 5 min). The link row is written as
 * soon as the environment exists so a failed install can be retried with
 * "Copy install command" instead of creating a second environment.
 */
export async function provisionCodaiEnvironment(
  input: ProvisionInput,
  emit: (ev: ProvisionEvent) => void,
  opts: { signal?: AbortSignal; by?: string } = {},
): Promise<ProvisionResult> {
  const { target, name: instanceName } = await loadCodaiSshTarget(input.instanceId);
  const secret = await getCodaiSettingsSecret();
  const client = new CodaiClient({ gatewayUrl: secret.gatewayUrl, apiKey: secret.apiKey });
  const envName = input.environmentName.trim() || instanceName;
  const audit = (status: "ok" | "error", message: string) =>
    db.insert(auditLog).values({ action: "codai.provision", target: input.instanceId, status, message: `${opts.by ? `[${opts.by}] ` : ""}${message}`.slice(0, 512) });

  try {
    emit({ type: "step", step: "project", message: input.projectId ? "Using existing codai project" : `Ensuring codai project "${input.projectName ?? envName}"` });
    const project = await client.ensureProject({ projectId: input.projectId, projectName: input.projectName ?? envName });

    emit({ type: "step", step: "environment", message: `Creating BYO environment "${envName}" in ${project.name}` });
    const existing = await getCodaiLink(input.instanceId);
    let env: CodaiEnvironment;
    if (existing && existing.projectId === project.id) {
      env = await client.getEnvironment(existing.environmentId);
      emit({ type: "line", text: `reusing linked environment ${env.slug} (${env.state})` });
    } else {
      env = await client.createByoEnvironment(project.id, envName);
    }
    await upsertCodaiLink({ instanceId: input.instanceId, environmentId: env.id, projectId: project.id, slug: env.slug, lastStatus: env.state });

    emit({ type: "step", step: "token", message: "Minting one-time enrol token (30 min)" });
    const tok = await client.mintEnrollToken(env.id);
    const command = buildInstallCommand({ enrollToken: tok.token, gatewayUrl: secret.gatewayUrl });
    const safeCommand = redactInstallCommand(command);

    emit({ type: "step", step: "install", message: `Running installer on ${target.user}@${target.host}` });
    emit({ type: "line", text: `$ ${safeCommand}` });
    const exitCode = await runInstall(target, command, (text) => emit({ type: "line", text: redactInstallCommand(text) }));
    if (exitCode !== null && exitCode !== 0) {
      emit({ type: "line", text: `installer exited with code ${exitCode}` });
    }

    emit({ type: "step", step: "poll", message: "Waiting for codaid to enrol" });
    const final = await pollUntilEnrolled(client, env.id, (e) => emit({ type: "line", text: `environment ${e.slug}: ${e.state}` }), opts.signal);
    await updateCodaiLinkStatus(input.instanceId, final.state);

    const okState = ENROLLED_STATES.has(final.state);
    await audit(okState ? "ok" : "error", `${final.slug} → ${final.state} (install exit ${exitCode ?? "?"}) ${safeCommand}`);
    emit({ type: "done", environmentId: env.id, projectId: project.id, slug: env.slug, state: final.state });
    return { environmentId: env.id, projectId: project.id, slug: env.slug, state: final.state, installExitCode: exitCode, command: safeCommand };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await audit("error", redactInstallCommand(message));
    emit({ type: "error", message: redactInstallCommand(message) });
    throw err;
  }
}

/** Re-mint a token for an already-linked instance and return the full command (shown once, never stored). */
export async function mintInstallCommand(instanceId: string): Promise<{ command: string; expiresAt: string }> {
  const link = await getCodaiLink(instanceId);
  if (!link) throw new Error("Instance is not linked to a codai environment");
  const secret = await getCodaiSettingsSecret();
  const client = new CodaiClient({ gatewayUrl: secret.gatewayUrl, apiKey: secret.apiKey });
  const tok = await client.mintEnrollToken(link.environmentId);
  return { command: buildInstallCommand({ enrollToken: tok.token, gatewayUrl: secret.gatewayUrl }), expiresAt: tok.expires_at };
}

/** Refresh the cached state from codai; returns null when not linked. */
export async function refreshCodaiStatus(instanceId: string): Promise<{ environmentId: string; projectId: string; slug: string; state: string } | null> {
  const link = await getCodaiLink(instanceId);
  if (!link) return null;
  const secret = await getCodaiSettingsSecret();
  const client = new CodaiClient({ gatewayUrl: secret.gatewayUrl, apiKey: secret.apiKey });
  const env = await client.getEnvironment(link.environmentId);
  await updateCodaiLinkStatus(instanceId, env.state);
  return { environmentId: env.id, projectId: link.projectId, slug: env.slug, state: env.state };
}
