"use server";

import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, cachedResources, cloudAccounts } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers/registry";
import { requireRole } from "@/lib/auth";

const schema = z.object({
  accountId: z.string().min(1),
  keepLast: z.number().int().min(0).max(1000),
});

export async function updateSnapshotRetentionAction(
  input: z.infer<typeof schema>,
): Promise<{ ok: boolean; error?: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  await db
    .update(cloudAccounts)
    .set({ snapshotRetentionCount: parsed.data.keepLast === 0 ? null : parsed.data.keepLast })
    .where(eq(cloudAccounts.id, parsed.data.accountId));
  await db.insert(auditLog).values({
    accountId: parsed.data.accountId,
    action: "account.snapshot-retention.update",
    status: "ok",
    message: parsed.data.keepLast === 0 ? "(disabled)" : `keep last ${parsed.data.keepLast}`,
  });
  revalidatePath("/accounts");
  return { ok: true };
}

export interface RetentionPreview {
  accountId: string;
  keepLast: number;
  instanceCount: number;
  candidatesToDelete: number;
}

/**
 * Dry-run preview: count snapshots that would be deleted if retention ran
 * right now. Groups cached snapshots by instance using the same name
 * heuristic as the snapshot UI.
 */
export async function previewSnapshotRetentionAction(
  accountId: string,
): Promise<RetentionPreview | null> {
  const acc = await db.query.cloudAccounts.findFirst({ where: eq(cloudAccounts.id, accountId) });
  if (!acc || !acc.snapshotRetentionCount) return null;
  const snaps = await db
    .select()
    .from(cachedResources)
    .where(eq(cachedResources.accountId, accountId));
  const onlySnaps = snaps.filter((s) => s.kind === "snapshot");
  // Bucket by attachedToInstanceId where set, else by name prefix up to the first dash.
  const buckets = new Map<string, typeof onlySnaps>();
  for (const s of onlySnaps) {
    const key = s.attachedToInstanceId ?? s.name ?? s.externalId;
    const arr = buckets.get(key) ?? [];
    arr.push(s);
    buckets.set(key, arr);
  }
  let candidates = 0;
  for (const arr of buckets.values()) {
    if (arr.length > acc.snapshotRetentionCount) {
      candidates += arr.length - acc.snapshotRetentionCount;
    }
  }
  return {
    accountId,
    keepLast: acc.snapshotRetentionCount,
    instanceCount: buckets.size,
    candidatesToDelete: candidates,
  };
}

/**
 * Apply the retention policy: for each instance bucket, keep the
 * `snapshotRetentionCount` most recent snapshots (by lastSyncedAt) and
 * delete the rest. Failures per snapshot are audit-logged and don't abort.
 */
export async function applySnapshotRetentionAction(
  accountId: string,
): Promise<{ ok: boolean; deleted: number; failed: number; error?: string }> {
  const acc = await db.query.cloudAccounts.findFirst({ where: eq(cloudAccounts.id, accountId) });
  if (!acc || !acc.snapshotRetentionCount) {
    return { ok: false, deleted: 0, failed: 0, error: "Retention not configured" };
  }
  const keepLast = acc.snapshotRetentionCount;

  let provider;
  try {
    ({ provider } = await getProvider(accountId));
  } catch (e) {
    return { ok: false, deleted: 0, failed: 0, error: e instanceof Error ? e.message : "provider error" };
  }
  if (!provider.deleteSnapshot) {
    return { ok: false, deleted: 0, failed: 0, error: `${provider.id} does not support snapshot delete` };
  }

  const snaps = await db
    .select()
    .from(cachedResources)
    .where(eq(cachedResources.accountId, accountId));
  const onlySnaps = snaps.filter((s) => s.kind === "snapshot");
  const buckets = new Map<string, typeof onlySnaps>();
  for (const s of onlySnaps) {
    const key = s.attachedToInstanceId ?? s.name ?? s.externalId;
    const arr = buckets.get(key) ?? [];
    arr.push(s);
    buckets.set(key, arr);
  }

  let deleted = 0;
  let failed = 0;
  for (const arr of buckets.values()) {
    if (arr.length <= keepLast) continue;
    const sorted = arr.slice().sort((a, b) => b.lastSyncedAt.getTime() - a.lastSyncedAt.getTime());
    const toRemove = sorted.slice(keepLast);
    for (const s of toRemove) {
      try {
        await provider.deleteSnapshot!(s.region, s.externalId);
        await db.delete(cachedResources).where(eq(cachedResources.id, s.id));
        deleted++;
      } catch (err) {
        failed++;
        await db.insert(auditLog).values({
          accountId,
          action: "snapshot.retention.delete",
          target: s.externalId,
          status: "error",
          message: err instanceof Error ? err.message : "delete failed",
        });
      }
    }
  }
  await db.insert(auditLog).values({
    accountId,
    action: "snapshot.retention.run",
    status: failed === 0 ? "ok" : "error",
    message: `deleted=${deleted} failed=${failed} keepLast=${keepLast}`,
  });
  revalidatePath("/");
  revalidatePath("/instances");
  return { ok: failed === 0, deleted, failed };
}
