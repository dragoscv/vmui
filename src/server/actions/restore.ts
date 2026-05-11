"use server";

import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { backupJobs, backupPolicies, instances, cloudAccounts, auditLog } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { getProvider } from "@/lib/providers/registry";

const restoreSchema = z.object({
  backupJobId: z.string().min(1),
  accountId: z.string().min(1),
  region: z.string().min(1),
  name: z.string().min(1).max(80),
  instanceType: z.string().min(1),
  template: z.string().min(1),
});

export async function restoreFromBackupAction(input: z.infer<typeof restoreSchema>) {
  await requireRole("operator");
  const parsed = restoreSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  const v = parsed.data;
  const job = db.select().from(backupJobs).where(eq(backupJobs.id, v.backupJobId)).get();
  if (!job) return { ok: false as const, error: "backup job not found" };
  if (job.status !== "ok") return { ok: false as const, error: "job is not successful" };
  const snapshotId = (job.artifactRef ?? "").split(" ")[0]!;
  if (!snapshotId) return { ok: false as const, error: "no snapshot ref on job" };

  try {
    const { provider } = await getProvider(v.accountId);
    const result = await provider.createInstance({
      region: v.region,
      name: v.name,
      template: v.template,
      instanceType: v.instanceType,
      fromSnapshotId: snapshotId,
    });
    db.insert(auditLog).values({
      action: "restore.from_snapshot",
      target: result.providerInstanceId,
      status: "ok",
      message: `${snapshotId} -> ${v.name} (${v.region})`,
    }).run();
    return { ok: true as const, providerInstanceId: result.providerInstanceId, message: "Instance launched from snapshot" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.insert(auditLog).values({
      action: "restore.from_snapshot",
      target: snapshotId,
      status: "error",
      message: msg,
    }).run();
    return { ok: false as const, error: msg };
  }
}

export async function listSuccessfulBackupJobsAction() {
  await requireRole("viewer");
  const rows = await db
    .select({
      job: backupJobs,
      policy: backupPolicies,
    })
    .from(backupJobs)
    .leftJoin(backupPolicies, eq(backupJobs.policyId, backupPolicies.id))
    .where(eq(backupJobs.status, "ok"))
    .orderBy(desc(backupJobs.startedAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.job.id,
    startedAt: r.job.startedAt,
    artifactRef: r.job.artifactRef,
    sizeBytes: r.job.sizeBytes,
    policyName: r.policy?.name ?? "(deleted policy)",
    kind: r.policy?.kind ?? null,
    instanceId: r.policy?.instanceId ?? null,
  }));
}

export async function listAccountRegionsForRestoreAction() {
  await requireRole("viewer");
  const accs = await db.select().from(cloudAccounts);
  const insts = await db.select().from(instances);
  return accs.map((a) => {
    const regions = Array.from(
      new Set(insts.filter((i) => i.accountId === a.id).map((i) => i.region)),
    ).sort();
    return {
      id: a.id,
      name: a.name,
      provider: a.provider,
      defaultRegion: a.defaultRegion,
      regions: regions.length > 0 ? regions : [a.defaultRegion ?? ""].filter(Boolean),
    };
  });
}
