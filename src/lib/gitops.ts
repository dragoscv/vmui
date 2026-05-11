import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitSources, gitApplyHistory, instances, cloudAccounts, auditLog } from "@/lib/db/schema";
import { decryptJSON, encryptJSON } from "@/lib/crypto";
import { sshExec } from "@/lib/ssh-exec";
import type { ProbeKey } from "@/lib/probe";
import { sendPush } from "@/lib/push";

export interface GitAuth {
  token?: string;
  sshKey?: string;
  username?: string;
}

export function encryptGitAuth(a: GitAuth): string {
  return encryptJSON(a);
}

function decryptGitAuth(blob: string): GitAuth {
  return decryptJSON<GitAuth>(blob);
}

interface SpawnResult { code: number; stdout: string; stderr: string }

function runLocal(cmd: string, args: string[], cwd: string, env?: Record<string, string>): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    child.stdout.on("data", (b) => out.push(b as Buffer));
    child.stderr.on("data", (b) => err.push(b as Buffer));
    child.on("close", (code) =>
      resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }),
    );
    child.on("error", (e) => resolve({ code: -1, stdout: "", stderr: e.message }));
  });
}

const VMUI_GIT_CACHE = process.env.VMUI_GIT_CACHE ?? path.join(tmpdir(), "vmui-git");

function repoDir(sourceId: string): string {
  return path.join(VMUI_GIT_CACHE, sourceId);
}

function buildAuthUrl(url: string, auth: GitAuth): string {
  if (!auth.token) return url;
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") {
      u.username = auth.username || "x-access-token";
      u.password = auth.token;
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return url;
}

async function gitWithSshKey(args: string[], cwd: string, sshKey: string): Promise<SpawnResult> {
  const keyDir = await mkdtemp(path.join(tmpdir(), "vmui-gitkey-"));
  const keyPath = path.join(keyDir, "id");
  try {
    await writeFile(keyPath, sshKey.endsWith("\n") ? sshKey : `${sshKey}\n`, { mode: 0o600 });
    const sshCmd = `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null`;
    return await runLocal("git", args, cwd, { GIT_SSH_COMMAND: sshCmd });
  } finally {
    await rm(keyDir, { recursive: true, force: true });
  }
}

async function gitClone(sourceId: string, url: string, branch: string, auth: GitAuth, authType: string): Promise<SpawnResult> {
  await mkdir(VMUI_GIT_CACHE, { recursive: true });
  const dir = repoDir(sourceId);
  if (existsSync(dir)) {
    // Fetch + reset to latest.
    if (authType === "ssh" && auth.sshKey) {
      const f = await gitWithSshKey(["fetch", "origin", branch], dir, auth.sshKey);
      if (f.code !== 0) return f;
      return await runLocal("git", ["reset", "--hard", `origin/${branch}`], dir);
    }
    const remote = buildAuthUrl(url, auth);
    const r1 = await runLocal("git", ["remote", "set-url", "origin", remote], dir);
    if (r1.code !== 0) return r1;
    const f = await runLocal("git", ["fetch", "origin", branch], dir);
    if (f.code !== 0) return f;
    return await runLocal("git", ["reset", "--hard", `origin/${branch}`], dir);
  }
  // Initial clone.
  if (authType === "ssh" && auth.sshKey) {
    return await gitWithSshKey(["clone", "--depth", "20", "--branch", branch, url, dir], VMUI_GIT_CACHE, auth.sshKey);
  }
  const remote = buildAuthUrl(url, auth);
  return await runLocal("git", ["clone", "--depth", "20", "--branch", branch, remote, dir], VMUI_GIT_CACHE);
}

async function headCommit(dir: string): Promise<string | null> {
  const r = await runLocal("git", ["rev-parse", "HEAD"], dir);
  return r.code === 0 ? r.stdout.trim() : null;
}

async function findComposeFiles(root: string, glob: string): Promise<string[]> {
  // Convert simple glob to regex (handles **, *, ?).
  const re = new RegExp(
    "^" +
      glob
        .replace(/[.+^$()|[\]{}\\]/g, "\\$&")
        .replace(/\*\*/g, "::DOUBLESTAR::")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/::DOUBLESTAR::/g, ".*") +
      "$",
  );
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".git")) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (e.isDirectory()) {
        await walk(full);
      } else if (re.test(rel)) {
        out.push(rel);
      }
    }
  }
  await walk(root);
  return out;
}

async function applyComposeToInstance(instanceId: string, name: string, body: string): Promise<{ ok: boolean; message: string }> {
  const inst = db.select().from(instances).where(eq(instances.id, instanceId)).get();
  if (!inst || (!inst.publicIp && !inst.publicDns)) {
    return { ok: false, message: "instance unreachable" };
  }
  const acc = db.select().from(cloudAccounts).where(eq(cloudAccounts.id, inst.accountId)).get();
  if (!acc?.probeKeyEnc) return { ok: false, message: "no probe key" };
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const b64 = Buffer.from(body, "utf8").toString("base64");
  const script = [
    `set -e`,
    `sudo mkdir -p /opt/compose/${safe}`,
    `echo '${b64}' | base64 -d | sudo tee /opt/compose/${safe}/docker-compose.yml > /dev/null`,
    `cd /opt/compose/${safe}`,
    `sudo docker compose pull || true`,
    `sudo docker compose up -d`,
  ].join(" && ");
  const r = await sshExec({
    host: inst.publicIp ?? inst.publicDns!,
    port: 22,
    user: key.defaultUser ?? (inst.provider === "aws" ? "ec2-user" : "ubuntu"),
    key,
    command: script,
    timeoutMs: 5 * 60_000,
  });
  return { ok: r.code === 0, message: `${r.stdout}\n${r.stderr}`.slice(-2000) };
}

/**
 * Sync one source: pull latest, find compose files, apply changed ones to
 * the configured target. Records history rows for everything we touched and
 * sends a push when any application changes state.
 */
export async function syncGitSource(sourceId: string): Promise<{ ok: boolean; commit: string | null; changes: number; error?: string }> {
  const src = db.select().from(gitSources).where(eq(gitSources.id, sourceId)).get();
  if (!src) return { ok: false, commit: null, changes: 0, error: "source not found" };

  const auth = src.authBlob ? decryptGitAuth(src.authBlob) : {};
  const clone = await gitClone(src.id, src.url, src.branch, auth, src.authType);
  if (clone.code !== 0) {
    const msg = (clone.stderr || clone.stdout).slice(0, 500);
    db.update(gitSources)
      .set({ lastError: msg, lastSyncedAt: new Date() })
      .where(eq(gitSources.id, src.id))
      .run();
    return { ok: false, commit: null, changes: 0, error: msg };
  }

  const dir = repoDir(src.id);
  const commit = await headCommit(dir);
  const isNew = commit && commit !== src.lastCommit;
  const files = await findComposeFiles(dir, src.composeGlob);

  let changes = 0;
  if (isNew && src.targetInstanceId) {
    for (const rel of files) {
      const body = await readFile(path.join(dir, rel), "utf8");
      const name = `git-${src.name}-${path.basename(path.dirname(rel))}`;
      const res = await applyComposeToInstance(src.targetInstanceId, name, body);
      db.insert(gitApplyHistory)
        .values({
          id: randomUUID(),
          sourceId: src.id,
          commit: commit ?? "",
          path: rel,
          status: res.ok ? "success" : "failed",
          message: res.message.slice(0, 1500),
        })
        .run();
      if (res.ok) changes++;
    }
  }

  db.update(gitSources)
    .set({
      lastCommit: commit,
      lastSyncedAt: new Date(),
      lastError: null,
    })
    .where(eq(gitSources.id, src.id))
    .run();

  db.insert(auditLog)
    .values({
      action: "gitops.sync",
      target: src.id,
      status: "ok",
      message: `${src.name} ${commit?.slice(0, 8) ?? ""} (${changes} applied)`,
    })
    .run();

  if (changes > 0) {
    void sendPush("state", {
      title: "GitOps applied",
      body: `${src.name}: ${changes} compose file(s) updated to ${commit?.slice(0, 8) ?? ""}`,
      url: "/gitops",
      tag: `gitops:${src.id}`,
    });
  }

  return { ok: true, commit, changes };
}

let timer: NodeJS.Timeout | null = null;

/** Lightweight in-process scheduler. Polls every 30s and runs any source whose pollSeconds has elapsed. */
export function ensureGitopsSchedulerRunning(): void {
  if (timer) return;
  // Skip in test / build phases.
  if (process.env.NODE_ENV === "test") return;
  const tick = async () => {
    try {
      const all = db.select().from(gitSources).all();
      const now = Date.now();
      for (const s of all) {
        if (!s.enabled) continue;
        const last = s.lastSyncedAt ? new Date(s.lastSyncedAt).getTime() : 0;
        if (now - last < s.pollSeconds * 1000) continue;
        await syncGitSource(s.id);
      }
    } catch {
      /* swallow */
    }
  };
  timer = setInterval(tick, 30_000);
  setTimeout(() => void tick(), 5000);
}

export async function deleteGitSourceCache(sourceId: string): Promise<void> {
  await rm(repoDir(sourceId), { recursive: true, force: true });
}

export async function statSourceRepo(sourceId: string): Promise<{ exists: boolean; bytes: number }> {
  const dir = repoDir(sourceId);
  if (!existsSync(dir)) return { exists: false, bytes: 0 };
  let bytes = 0;
  async function walk(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        const s = await stat(full);
        bytes += s.size;
      }
    }
  }
  try {
    await walk(dir);
  } catch {
    /* ignore */
  }
  return { exists: true, bytes };
}
