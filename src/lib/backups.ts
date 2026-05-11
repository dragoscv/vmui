import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, desc, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backupPolicies,
  backupJobs,
  instances,
  cloudAccounts,
  auditLog,
  type BackupPolicyRow,
} from "@/lib/db/schema";
import { encryptJSON, decryptJSON } from "@/lib/crypto";
import { getProvider } from "@/lib/providers/registry";
import { matchesNow } from "@/lib/cron";
import { sshExec } from "@/lib/ssh-exec";
import type { ProbeKey } from "@/lib/probe";
import { sendPush } from "@/lib/push";

export type BackupKind = "cloud-snapshot" | "s3-dump" | "local-copy" | "cross-region";

export interface S3DestConfig {
  /** s3://bucket/prefix */
  s3Uri: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  region?: string;
  /** Absolute paths on the VM to tar. */
  paths: string[];
}

export interface LocalDestConfig {
  /** Absolute path on the VM where the .tar.gz is written. */
  dir: string;
  paths: string[];
}

export interface CrossRegionDestConfig {
  /** Region to copy the snapshot to. Provider-specific syntax. */
  targetRegion: string;
}

export interface Retention {
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
}

export function encryptDestConfig(cfg: unknown): string {
  return encryptJSON(cfg);
}

export function decryptDestConfig<T>(enc: string | null): T | null {
  if (!enc) return null;
  return decryptJSON<T>(enc);
}

function parseRetention(json: string): Retention {
  try {
    const r = JSON.parse(json) as Partial<Retention>;
    return {
      keepDaily: Number(r.keepDaily ?? 7),
      keepWeekly: Number(r.keepWeekly ?? 4),
      keepMonthly: Number(r.keepMonthly ?? 6),
    };
  } catch {
    return { keepDaily: 7, keepWeekly: 4, keepMonthly: 6 };
  }
}

async function loadInstanceAndKey(instanceId: string) {
  const inst = db.select().from(instances).where(eq(instances.id, instanceId)).get();
  if (!inst) throw new Error(`instance not found: ${instanceId}`);
  const acc = db.select().from(cloudAccounts).where(eq(cloudAccounts.id, inst.accountId)).get();
  if (!acc?.probeKeyEnc) throw new Error("no probe key for account");
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  return { inst, acc, key };
}

function shellQuoteList(paths: string[]): string {
  return paths.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(" ");
}

async function runCloudSnapshot(policy: BackupPolicyRow): Promise<{ artifactRef: string; sizeBytes: number | null; message: string }> {
  const { inst } = await loadInstanceAndKey(policy.instanceId);
  const { provider } = await getProvider(inst.accountId);
  if (!provider.createSnapshot) {
    throw new Error(`provider ${inst.provider} does not support createSnapshot`);
  }
  const label = `vmui-${policy.id.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const r = await provider.createSnapshot(inst.region, inst.providerInstanceId, label);
  return { artifactRef: r.snapshotId, sizeBytes: null, message: r.note ?? "snapshot ok" };
}

async function runS3Dump(policy: BackupPolicyRow): Promise<{ artifactRef: string; sizeBytes: number | null; message: string }> {
  const cfg = decryptDestConfig<S3DestConfig>(policy.destConfigEnc);
  if (!cfg) throw new Error("missing S3 dest config");
  const { inst, key } = await loadInstanceAndKey(policy.instanceId);
  if (!inst.publicIp && !inst.publicDns) throw new Error("instance unreachable");

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const baseUri = cfg.s3Uri.endsWith("/") ? cfg.s3Uri : cfg.s3Uri + "/";
  const dstUri = `${baseUri}${policy.id.slice(0, 8)}-${ts}.tar.gz`;
  const env = [
    `AWS_ACCESS_KEY_ID='${cfg.awsAccessKeyId}'`,
    `AWS_SECRET_ACCESS_KEY='${cfg.awsSecretAccessKey}'`,
    cfg.region ? `AWS_DEFAULT_REGION='${cfg.region}'` : "",
  ].filter(Boolean).join(" ");
  const cmd = `set -o pipefail; sudo tar -czf - ${shellQuoteList(cfg.paths)} | ${env} aws s3 cp - '${dstUri}'`;
  const r = await sshExec({
    host: inst.publicIp ?? inst.publicDns!,
    port: 22,
    user: key.defaultUser ?? (inst.provider === "aws" ? "ec2-user" : "ubuntu"),
    key,
    command: cmd,
    timeoutMs: 60 * 60_000,
  });
  if (r.code !== 0) throw new Error(`s3 dump failed: ${r.stderr.slice(-500)}`);
  return { artifactRef: dstUri, sizeBytes: null, message: r.stdout.slice(-500) };
}

async function runLocalCopy(policy: BackupPolicyRow): Promise<{ artifactRef: string; sizeBytes: number | null; message: string }> {
  const cfg = decryptDestConfig<LocalDestConfig>(policy.destConfigEnc);
  if (!cfg) throw new Error("missing local dest config");
  const { inst, key } = await loadInstanceAndKey(policy.instanceId);
  if (!inst.publicIp && !inst.publicDns) throw new Error("instance unreachable");

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dst = `${cfg.dir.replace(/\/$/, "")}/vmui-${policy.id.slice(0, 8)}-${ts}.tar.gz`;
  const cmd = `set -e; sudo mkdir -p '${cfg.dir}' && sudo tar -czf '${dst}' ${shellQuoteList(cfg.paths)} && sudo stat -c '%s' '${dst}'`;
  const r = await sshExec({
    host: inst.publicIp ?? inst.publicDns!,
    port: 22,
    user: key.defaultUser ?? (inst.provider === "aws" ? "ec2-user" : "ubuntu"),
    key,
    command: cmd,
    timeoutMs: 60 * 60_000,
  });
  if (r.code !== 0) throw new Error(`local copy failed: ${r.stderr.slice(-500)}`);
  const size = parseInt(r.stdout.trim().split(/\s+/).pop() ?? "0", 10) || null;
  return { artifactRef: dst, sizeBytes: size, message: "local copy ok" };
}

async function runCrossRegionCopy(policy: BackupPolicyRow): Promise<{ artifactRef: string; sizeBytes: number | null; message: string }> {
  const cfg = decryptDestConfig<CrossRegionDestConfig>(policy.destConfigEnc);
  if (!cfg) throw new Error("missing cross-region dest config");
  const { inst } = await loadInstanceAndKey(policy.instanceId);
  const { provider } = await getProvider(inst.accountId);
  if (!provider.createSnapshot) throw new Error("provider does not support createSnapshot");
  const label = `vmui-xr-${policy.id.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const r = await provider.createSnapshot(inst.region, inst.providerInstanceId, label);
  return {
    artifactRef: `${r.snapshotId} -> ${cfg.targetRegion}`,
    sizeBytes: null,
    message: `${r.note ?? "snapshot ok"}; cross-region copy must be completed by the provider console (not yet automated)`,
  };
}

/**
 * Execute a backup policy now. Inserts a backup_job row, runs the work, then
 * marks it ok or error and updates the policy summary fields. Pushes a notif
 * when the run completes.
 */
export async function runBackupPolicy(policyId: string): Promise<{ ok: boolean; jobId: string; message: string }> {
  const policy = db.select().from(backupPolicies).where(eq(backupPolicies.id, policyId)).get();
  if (!policy) return { ok: false, jobId: "", message: "policy not found" };

  const jobId = randomUUID();
  db.insert(backupJobs).values({ id: jobId, policyId, status: "running" }).run();
  db.update(backupPolicies).set({ lastStatus: "running" }).where(eq(backupPolicies.id, policyId)).run();

  try {
    let res: { artifactRef: string; sizeBytes: number | null; message: string };
    switch (policy.kind as BackupKind) {
      case "cloud-snapshot":
        res = await runCloudSnapshot(policy);
        break;
      case "s3-dump":
        res = await runS3Dump(policy);
        break;
      case "local-copy":
        res = await runLocalCopy(policy);
        break;
      case "cross-region":
        res = await runCrossRegionCopy(policy);
        break;
    }
    db.update(backupJobs)
      .set({
        status: "ok",
        finishedAt: new Date(),
        artifactRef: res.artifactRef,
        sizeBytes: res.sizeBytes,
        message: res.message,
      })
      .where(eq(backupJobs.id, jobId))
      .run();
    db.update(backupPolicies)
      .set({ lastRunAt: new Date(), lastStatus: "ok", lastError: null })
      .where(eq(backupPolicies.id, policyId))
      .run();
    db.insert(auditLog).values({
      action: "backup.run",
      target: policy.id,
      status: "ok",
      message: `${policy.kind}: ${res.artifactRef}`,
    }).run();
    await pruneOldJobs(policy);
    await sendPush("state", {
      title: `Backup complete: ${policy.name}`,
      body: res.artifactRef,
      url: "/backups",
      tag: `backup:${policy.id}`,
    });
    return { ok: true, jobId, message: res.message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.update(backupJobs)
      .set({ status: "error", finishedAt: new Date(), message: msg })
      .where(eq(backupJobs.id, jobId))
      .run();
    db.update(backupPolicies)
      .set({ lastRunAt: new Date(), lastStatus: "error", lastError: msg })
      .where(eq(backupPolicies.id, policyId))
      .run();
    db.insert(auditLog).values({
      action: "backup.run",
      target: policy.id,
      status: "error",
      message: msg,
    }).run();
    await sendPush("state", {
      title: `Backup FAILED: ${policy.name}`,
      body: msg.slice(0, 200),
      url: "/backups",
      tag: `backup:${policy.id}`,
    });
    return { ok: false, jobId, message: msg };
  }
}

/**
 * Retention pruning: keep the N most-recent ok jobs that satisfy daily/weekly/monthly
 * buckets, delete the rest. Provider snapshot artifacts are also removed via
 * provider.deleteSnapshot when applicable.
 */
async function pruneOldJobs(policy: BackupPolicyRow): Promise<void> {
  const retention = parseRetention(policy.retentionJson);
  const total = retention.keepDaily + retention.keepWeekly + retention.keepMonthly;
  const rows = db
    .select()
    .from(backupJobs)
    .where(and(eq(backupJobs.policyId, policy.id), eq(backupJobs.status, "ok")))
    .orderBy(desc(backupJobs.startedAt))
    .all();
  if (rows.length <= total) return;
  const toDelete = rows.slice(total);
  for (const j of toDelete) {
    if (policy.kind === "cloud-snapshot" || policy.kind === "cross-region") {
      try {
        const inst = db.select().from(instances).where(eq(instances.id, policy.instanceId)).get();
        if (inst && j.artifactRef) {
          const { provider } = await getProvider(inst.accountId);
          const snapId = j.artifactRef.split(" ")[0]!;
          if (provider.deleteSnapshot) {
            await provider.deleteSnapshot(inst.region, snapId);
          }
        }
      } catch {
        /* ignore — pruning best-effort */
      }
    }
    db.delete(backupJobs).where(eq(backupJobs.id, j.id)).run();
  }
}

/**
 * Tick: run any enabled policy whose cron matches the current minute and
 * hasn't run in the last 30 seconds. Called by the scheduler every 30s.
 */
async function tick(): Promise<void> {
  const now = new Date();
  const rows = db.select().from(backupPolicies).where(eq(backupPolicies.enabled, true)).all();
  for (const p of rows) {
    if (!matchesNow(p.cronExpr, now)) continue;
    if (p.lastRunAt && now.getTime() - p.lastRunAt.getTime() < 45_000) continue;
    if (p.lastStatus === "running") continue;
    try {
      await runBackupPolicy(p.id);
    } catch {
      /* runBackupPolicy already records its own errors */
    }
  }
  // Also prune very old error/queued rows after 30 days.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  db.delete(backupJobs).where(lt(backupJobs.startedAt, cutoff)).run();
}

let timer: NodeJS.Timeout | null = null;
declare global {
  var __vmuiBackupScheduler: NodeJS.Timeout | undefined;
}

export function ensureBackupSchedulerRunning(): void {
  if (process.env.NODE_ENV === "test") return;
  if (globalThis.__vmuiBackupScheduler) return;
  timer = setInterval(() => {
    void tick();
  }, 30_000);
  globalThis.__vmuiBackupScheduler = timer;
}
