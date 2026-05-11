import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { imageBuilds, registryCredentials, instances, cloudAccounts } from "@/lib/db/schema";
import { decryptJSON, encryptJSON } from "@/lib/crypto";
import { sshExec } from "@/lib/ssh-exec";
import type { ProbeKey } from "@/lib/probe";

export type RegistryType = "ecr" | "gcr" | "acr" | "dockerhub" | "ghcr";

export interface RegistryCreds {
  username?: string;
  password?: string;
  token?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  serviceAccountJson?: string;
}

export function encryptCreds(c: RegistryCreds): string {
  return encryptJSON(c);
}

export function decryptCreds(blob: string): RegistryCreds {
  return decryptJSON<RegistryCreds>(blob);
}

/**
 * Return shell snippet that logs the local docker CLI into the registry.
 * Snippet leaves $? === 0 on success. Secrets are passed via stdin where
 * possible, otherwise via an env var that is unset after the login call.
 */
export function loginCommand(type: RegistryType, registryUrl: string, c: RegistryCreds): string {
  switch (type) {
    case "ghcr":
    case "dockerhub": {
      const u = (c.username ?? "").replace(/'/g, "");
      const p = (c.token ?? c.password ?? "").replace(/'/g, "");
      return `echo '${p}' | docker login ${registryUrl} -u '${u}' --password-stdin`;
    }
    case "ecr": {
      const region = c.region ?? "us-east-1";
      const ak = (c.accessKeyId ?? "").replace(/'/g, "");
      const sk = (c.secretAccessKey ?? "").replace(/'/g, "");
      return `AWS_ACCESS_KEY_ID='${ak}' AWS_SECRET_ACCESS_KEY='${sk}' aws ecr get-login-password --region '${region}' | docker login --username AWS --password-stdin ${registryUrl}`;
    }
    case "gcr": {
      const sa = (c.serviceAccountJson ?? "").replace(/'/g, "");
      return `printf '%s' '${sa}' | docker login -u _json_key --password-stdin https://${registryUrl}`;
    }
    case "acr": {
      const u = (c.username ?? "").replace(/'/g, "");
      const p = (c.password ?? c.token ?? "").replace(/'/g, "");
      return `echo '${p}' | docker login ${registryUrl} -u '${u}' --password-stdin`;
    }
  }
}

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runLocal(cmd: string, args: string[], cwd: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const child = spawn(cmd, args, { cwd, env: process.env });
    child.stdout.on("data", (b) => out.push(b as Buffer));
    child.stderr.on("data", (b) => err.push(b as Buffer));
    child.on("close", (code) =>
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      }),
    );
    child.on("error", (e) => resolve({ code: -1, stdout: "", stderr: e.message }));
  });
}

interface BuildOpts {
  buildId: string;
  registryId: string;
  imageRef: string;
  dockerfile: string;
  buildLocation: "local" | "remote";
  instanceId?: string;
}

/**
 * Execute a build+push. Updates the imageBuilds row inline with status and
 * captured logs. Returns nothing — callers should poll the row.
 */
export async function runBuild(opts: BuildOpts): Promise<void> {
  const { buildId } = opts;
  const setStatus = (status: "running" | "success" | "failed", log: string, finished = false) => {
    db.update(imageBuilds)
      .set({
        status,
        logOutput: log.slice(-50_000),
        ...(finished ? { finishedAt: new Date() } : {}),
      })
      .where(eq(imageBuilds.id, buildId))
      .run();
  };

  setStatus("running", "");

  const reg = db.select().from(registryCredentials).where(eq(registryCredentials.id, opts.registryId)).get();
  if (!reg) {
    setStatus("failed", "registry not found", true);
    return;
  }
  const creds = decryptCreds(reg.credentials);
  const login = loginCommand(reg.type as RegistryType, reg.registryUrl, creds);

  if (opts.buildLocation === "local") {
    const dir = await mkdtemp(path.join(tmpdir(), "vmui-build-"));
    try {
      await writeFile(path.join(dir, "Dockerfile"), opts.dockerfile, "utf8");
      const logs: string[] = [];
      const append = (label: string, r: SpawnResult) => {
        logs.push(`$ ${label}\n${r.stdout}${r.stderr}\n[exit ${r.code}]\n`);
      };
      const loginRes = await runLocal("sh", ["-c", login], dir);
      append("docker login", loginRes);
      if (loginRes.code !== 0) {
        setStatus("failed", logs.join("\n"), true);
        return;
      }
      const buildRes = await runLocal("docker", ["build", "-t", opts.imageRef, "."], dir);
      append(`docker build -t ${opts.imageRef} .`, buildRes);
      if (buildRes.code !== 0) {
        setStatus("failed", logs.join("\n"), true);
        return;
      }
      const pushRes = await runLocal("docker", ["push", opts.imageRef], dir);
      append(`docker push ${opts.imageRef}`, pushRes);
      setStatus(pushRes.code === 0 ? "success" : "failed", logs.join("\n"), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return;
  }

  // remote
  if (!opts.instanceId) {
    setStatus("failed", "instanceId required for remote build", true);
    return;
  }
  const inst = db.select().from(instances).where(eq(instances.id, opts.instanceId)).get();
  if (!inst || (!inst.publicIp && !inst.publicDns)) {
    setStatus("failed", "instance unreachable", true);
    return;
  }
  const acc = db.select().from(cloudAccounts).where(eq(cloudAccounts.id, inst.accountId)).get();
  if (!acc?.probeKeyEnc) {
    setStatus("failed", "probe key missing", true);
    return;
  }
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);

  const workDir = `/tmp/vmui-build-${randomUUID()}`;
  const dockerfileB64 = Buffer.from(opts.dockerfile, "utf8").toString("base64");
  const script = [
    `set -e`,
    `mkdir -p ${workDir}`,
    `echo '${dockerfileB64}' | base64 -d > ${workDir}/Dockerfile`,
    `cd ${workDir}`,
    login,
    `sudo docker build -t ${opts.imageRef} . || docker build -t ${opts.imageRef} .`,
    `sudo docker push ${opts.imageRef} || docker push ${opts.imageRef}`,
    `cd / && rm -rf ${workDir}`,
  ].join(" && ");

  const host = inst.publicIp ?? inst.publicDns!;
  const r = await sshExec({
    host,
    port: 22,
    user: key.defaultUser ?? (inst.provider === "aws" ? "ec2-user" : "ubuntu"),
    key,
    command: script,
    timeoutMs: 30 * 60_000,
  });
  const log = `STDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}\n[exit ${r.code}]`;
  setStatus(r.code === 0 ? "success" : "failed", log, true);
}
