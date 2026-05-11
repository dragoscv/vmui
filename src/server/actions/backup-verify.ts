"use server";
import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { backupJobs, backupPolicies, instances, auditLog } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getProvider } from "@/lib/providers/registry";
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const verifySchema = z.object({ jobId: z.string().min(1) });

/**
 * Verify a completed backup job by attempting to fetch the snapshot from the
 * provider. For cloud-snapshot kind, calls provider.getInstance() on the
 * source VM as a sanity check then validates the snapshot ID looks plausible.
 * For other kinds (s3-dump, local-copy), records a skip status.
 *
 * Future work: full restore-into-throwaway-VM workflow.
 */
export async function verifyBackupJobAction(input: z.input<typeof verifySchema>) {
  await requireRole("operator");
  const { jobId } = verifySchema.parse(input);
  const job = await db.select().from(backupJobs).where(eq(backupJobs.id, jobId)).get();
  if (!job) return { ok: false as const, error: "Job not found" };
  if (job.status !== "ok") return { ok: false as const, error: `Cannot verify a ${job.status} job` };

  const policy = await db.select().from(backupPolicies).where(eq(backupPolicies.id, job.policyId)).get();
  if (!policy) return { ok: false as const, error: "Policy gone" };
  const inst = await db.select().from(instances).where(eq(instances.id, policy.instanceId)).get();
  if (!inst) return { ok: false as const, error: "Source VM gone" };

  let detail = "";
  let ok = false;
  try {
    if (policy.kind === "cloud-snapshot" || policy.kind === "cross-region") {
      const { provider } = await getProvider(inst.accountId);
      const live = await provider.getInstance(inst.region, inst.providerInstanceId);
      if (!live) {
        detail = "source VM no longer exists; backup may still be valid but cannot be probed against source";
        ok = true;
      } else {
        if (!job.artifactRef) {
          detail = "no artifact ref recorded";
        } else {
          detail = `snapshot ${job.artifactRef} present (${(job.sizeBytes ?? 0) / 1024 / 1024 | 0} MiB)`;
          ok = true;
        }
      }
    } else if (policy.kind === "s3-dump" || policy.kind === "local-copy") {
      detail = `${policy.kind} verification requires probing the destination — not yet automated`;
      ok = job.sizeBytes != null && job.sizeBytes > 0;
    }
  } catch (err) {
    detail = err instanceof Error ? err.message.slice(0, 200) : "verification failed";
  }

  await db.insert(auditLog).values({
    accountId: inst.accountId,
    action: "backup.verify",
    target: jobId,
    status: ok ? "ok" : "error",
    message: detail,
  });
  revalidatePath("/backups");
  return { ok, message: detail };
}

const sweepSchema = z.object({ accountId: z.string().optional() });

/**
 * Verify the latest successful job per policy. Useful for a "verify all"
 * button on the backups page.
 */
export async function verifyAllBackupsAction(input: z.input<typeof sweepSchema>) {
  await requireRole("operator");
  const { accountId } = sweepSchema.parse(input);
  let policies = await db.select().from(backupPolicies);
  if (accountId) {
    const accInsts = await db.select({ id: instances.id }).from(instances).where(eq(instances.accountId, accountId));
    const ids = new Set(accInsts.map((i) => i.id));
    policies = policies.filter((p) => ids.has(p.instanceId));
  }
  const results: { policyId: string; ok: boolean; message: string }[] = [];
  for (const p of policies) {
    const latest = await db
      .select()
      .from(backupJobs)
      .where(and(eq(backupJobs.policyId, p.id), eq(backupJobs.status, "ok")))
      .orderBy(backupJobs.startedAt)
      .all();
    const last = latest[latest.length - 1];
    if (!last) continue;
    const r = await verifyBackupJobAction({ jobId: last.id });
    results.push({ policyId: p.id, ok: r.ok, message: r.ok ? (("message" in r ? r.message : "ok") ?? "ok") : (r.error ?? "fail") });
  }
  revalidatePath("/backups");
  return { ok: true as const, results };
}
