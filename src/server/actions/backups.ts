"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { backupPolicies, backupJobs, auditLog } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { encryptDestConfig, runBackupPolicy } from "@/lib/backups";
import { isValidCron } from "@/lib/cron";

const retentionSchema = z.object({
  keepDaily: z.coerce.number().int().min(0).max(365).default(7),
  keepWeekly: z.coerce.number().int().min(0).max(52).default(4),
  keepMonthly: z.coerce.number().int().min(0).max(36).default(6),
});

const s3Schema = z.object({
  s3Uri: z.string().regex(/^s3:\/\/[^/]+\//),
  awsAccessKeyId: z.string().min(1),
  awsSecretAccessKey: z.string().min(1),
  region: z.string().optional(),
  paths: z.array(z.string().min(1)).min(1),
});
const localSchema = z.object({
  dir: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
});
const crossRegionSchema = z.object({
  targetRegion: z.string().min(1),
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["cloud-snapshot", "s3-dump", "local-copy", "cross-region"]),
  instanceId: z.string().min(1),
  cronExpr: z.string().min(1).refine(isValidCron, "invalid cron expression"),
  retention: retentionSchema,
  s3: s3Schema.optional(),
  local: localSchema.optional(),
  crossRegion: crossRegionSchema.optional(),
});

export async function createBackupPolicyAction(input: z.infer<typeof createSchema>) {
  await requireRole("operator");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  const v = parsed.data;

  let destEnc: string | null = null;
  if (v.kind === "s3-dump") {
    if (!v.s3) return { ok: false as const, error: "S3 dest required" };
    destEnc = encryptDestConfig(v.s3);
  } else if (v.kind === "local-copy") {
    if (!v.local) return { ok: false as const, error: "local dest required" };
    destEnc = encryptDestConfig(v.local);
  } else if (v.kind === "cross-region") {
    if (!v.crossRegion) return { ok: false as const, error: "target region required" };
    destEnc = encryptDestConfig(v.crossRegion);
  }

  const id = randomUUID();
  db.insert(backupPolicies)
    .values({
      id,
      name: v.name,
      kind: v.kind,
      instanceId: v.instanceId,
      cronExpr: v.cronExpr,
      retentionJson: JSON.stringify(v.retention),
      destConfigEnc: destEnc,
      enabled: true,
    })
    .run();
  db.insert(auditLog).values({
    action: "backup.policy.create",
    target: id,
    status: "ok",
    message: `${v.kind} ${v.name} (${v.cronExpr})`,
  }).run();
  revalidatePath("/backups");
  return { ok: true as const, id };
}

export async function deleteBackupPolicyAction(id: string) {
  await requireRole("operator");
  db.delete(backupPolicies).where(eq(backupPolicies.id, id)).run();
  db.insert(auditLog).values({ action: "backup.policy.delete", target: id, status: "ok" }).run();
  revalidatePath("/backups");
  return { ok: true as const };
}

export async function toggleBackupPolicyAction(id: string, enabled: boolean) {
  await requireRole("operator");
  db.update(backupPolicies).set({ enabled }).where(eq(backupPolicies.id, id)).run();
  revalidatePath("/backups");
  return { ok: true as const };
}

export async function runBackupNowAction(id: string) {
  await requireRole("operator");
  const r = await runBackupPolicy(id);
  revalidatePath("/backups");
  return r.ok ? { ok: true as const, message: r.message } : { ok: false as const, error: r.message };
}

export async function listBackupPoliciesAction() {
  await requireRole("viewer");
  const rows = db.select().from(backupPolicies).all();
  return rows.map(({ destConfigEnc: _omit, ...r }) => r);
}

export async function listBackupJobsAction(policyId: string) {
  await requireRole("viewer");
  return db
    .select()
    .from(backupJobs)
    .where(eq(backupJobs.policyId, policyId))
    .orderBy(desc(backupJobs.startedAt))
    .limit(50)
    .all();
}

export async function listRecentBackupJobsAction(limit = 20) {
  await requireRole("viewer");
  return db
    .select()
    .from(backupJobs)
    .orderBy(desc(backupJobs.startedAt))
    .limit(limit)
    .all();
}

// Suppress unused import warning if `and` is unused after edits
void and;
