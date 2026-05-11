"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, cachedResources, instances } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers/registry";
import { publishEvent } from "@/lib/event-bus";
import { requireRole } from "@/lib/auth";

const createSchema = z.object({
  accountId: z.string().min(1),
  providerInstanceId: z.string().min(1),
  region: z.string().min(1).max(64),
  /** Free-form label / description tagged onto the snapshot. */
  label: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9 ._-]+$/u, "Use only letters, digits, space, dash, dot or underscore."),
});

export type CreateSnapshotResult =
  | { ok: true; snapshotId: string; note?: string }
  | { ok: false; error: string };

/**
 * Create a snapshot of an instance's boot disk. Provider must implement the
 * optional `createSnapshot` method (AWS, Azure, GCP do; Scaleway / local-kvm
 * currently do not).
 */
export async function createInstanceSnapshotAction(input: {
  accountId: string;
  providerInstanceId: string;
  region: string;
  label: string;
}): Promise<CreateSnapshotResult> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { accountId, providerInstanceId, region, label } = parsed.data;

  const { provider } = await getProvider(accountId);
  if (typeof provider.createSnapshot !== "function") {
    return { ok: false, error: `Snapshots are not supported for ${provider.id} yet.` };
  }

  try {
    const out = await provider.createSnapshot(region, providerInstanceId, label);
    await db.insert(auditLog).values({
      accountId,
      action: "instance.snapshot.create",
      target: providerInstanceId,
      status: "ok",
      message: `${out.snapshotId}${out.note ? ` · ${out.note}` : ""}`,
    });
    publishEvent({
      channel: "snapshot.created",
      payload: { accountId, providerInstanceId, snapshotId: out.snapshotId },
    });
    revalidatePath(`/instances`);
    return { ok: true, snapshotId: out.snapshotId, note: out.note };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Snapshot failed";
    await db.insert(auditLog).values({
      accountId,
      action: "instance.snapshot.create",
      target: providerInstanceId,
      status: "error",
      message,
    });
    return { ok: false, error: message };
  }
}

/**
 * List cached snapshot rows for a given instance. We can't always tie a
 * snapshot back to its source instance (cloud providers don't expose that
 * link cleanly), so we surface every snapshot in the same account+region
 * along with a heuristic match on the snapshot name containing the source
 * instance's id.
 */
const listSchema = z.object({
  accountId: z.string().min(1),
  region: z.string().min(1).max(64),
  providerInstanceId: z.string().min(1),
});

export interface InstanceSnapshotRow {
  id: string;
  externalId: string;
  name: string | null;
  status: string | null;
  sizeBytes: number | null;
  region: string;
  lastSyncedAt: Date;
  isLikelyMatch: boolean;
}

export async function listInstanceSnapshotsAction(input: {
  accountId: string;
  region: string;
  providerInstanceId: string;
}): Promise<{ ok: true; rows: InstanceSnapshotRow[] } | { ok: false; error: string }> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { accountId, region, providerInstanceId } = parsed.data;

  // Find the instance synthetic id so we can also include explicit attached_to matches.
  const inst = (
    await db
      .select()
      .from(instances)
      .where(and(eq(instances.accountId, accountId), eq(instances.providerInstanceId, providerInstanceId)))
      .limit(1)
  )[0];

  const rows = await db
    .select()
    .from(cachedResources)
    .where(and(eq(cachedResources.accountId, accountId), eq(cachedResources.kind, "snapshot")))
    .orderBy(desc(cachedResources.lastSyncedAt));

  const idToken = providerInstanceId.toLowerCase();
  const result: InstanceSnapshotRow[] = rows
    .filter((r) => r.region === region || r.region === "global")
    .map((r) => {
      const nameMatches = (r.name ?? "").toLowerCase().includes(idToken);
      const attachedMatches = inst != null && r.attachedToInstanceId === inst.id;
      return {
        id: r.id,
        externalId: r.externalId,
        name: r.name,
        status: r.status,
        sizeBytes: r.sizeBytes,
        region: r.region,
        lastSyncedAt: r.lastSyncedAt,
        isLikelyMatch: nameMatches || attachedMatches,
      };
    });

  return { ok: true, rows: result };
}

const restoreSchema = z.object({
  accountId: z.string().min(1),
  region: z.string().min(1).max(64),
  snapshotId: z.string().min(1).max(512),
  label: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9 ._-]+$/u, "Use only letters, digits, space, dash, dot or underscore."),
  instanceType: z.string().min(1).max(64),
});

export type RestoreSnapshotResult =
  | { ok: true; providerInstanceId: string }
  | { ok: false; error: string };

/**
 * Launch a fresh instance from an existing snapshot. AWS-only for now (Azure
 * + GCP follow once their image-from-snapshot flows are wired). The new VM
 * boots straight from the snapshot's disk; the original snapshot stays
 * intact and can be reused.
 */
export async function restoreInstanceFromSnapshotAction(input: {
  accountId: string;
  region: string;
  snapshotId: string;
  label: string;
  instanceType: string;
}): Promise<RestoreSnapshotResult> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = restoreSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { accountId, region, snapshotId, label, instanceType } = parsed.data;

  const { provider } = await getProvider(accountId);
  if (provider.id === "scaleway" || provider.id === "local-kvm") {
    return { ok: false, error: `Snapshot restore is not supported on ${provider.id}.` };
  }

  try {
    const safeName = label.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
    const newName = `restore-${safeName}-${Date.now().toString(36)}`.slice(0, 80);
    const template =
      provider.id === "aws" ? "ubuntu-22.04" : provider.id === "gcp" ? "gcp-debian-12" : "ubuntu-22.04";
    const inst = await provider.createInstance({
      region,
      name: newName,
      template,
      instanceType,
      fromSnapshotId: snapshotId,
    });
    await db.insert(auditLog).values({
      accountId,
      action: "instance.snapshot.restore",
      target: snapshotId,
      status: "ok",
      message: `New instance ${inst.providerInstanceId} (${inst.name ?? newName})`,
    });
    revalidatePath(`/instances`);
    return { ok: true, providerInstanceId: inst.providerInstanceId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restore failed";
    await db.insert(auditLog).values({
      accountId,
      action: "instance.snapshot.restore",
      target: snapshotId,
      status: "error",
      message,
    });
    return { ok: false, error: message };
  }
}

const deleteSchema = z.object({
  accountId: z.string().min(1),
  region: z.string().min(1).max(64),
  snapshotId: z.string().min(1).max(512),
});

export type DeleteSnapshotResult = { ok: true } | { ok: false; error: string };

/**
 * Permanently delete a snapshot. The snapshotId must be the provider's
 * external id (e.g. AWS snap-…, Azure full ARM id or `{rg}/{name}`, GCP
 * snapshot name). Frees storage costs immediately on AWS / GCP, async on
 * Azure.
 */
export async function deleteInstanceSnapshotAction(input: {
  accountId: string;
  region: string;
  snapshotId: string;
}): Promise<DeleteSnapshotResult> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { accountId, region, snapshotId } = parsed.data;

  const { provider } = await getProvider(accountId);
  if (typeof provider.deleteSnapshot !== "function") {
    return { ok: false, error: `Snapshot delete is not supported for ${provider.id} yet.` };
  }

  try {
    await provider.deleteSnapshot(region, snapshotId);
    await db.insert(auditLog).values({
      accountId,
      action: "instance.snapshot.delete",
      target: snapshotId,
      status: "ok",
    });
    // Best-effort: drop the row from the resources cache so the UI updates
    // immediately without waiting for the next resource sync.
    try {
      await db
        .delete(cachedResources)
        .where(
          and(
            eq(cachedResources.accountId, accountId),
            eq(cachedResources.externalId, snapshotId),
            eq(cachedResources.kind, "snapshot"),
          ),
        );
    } catch {
      /* non-fatal */
    }
    revalidatePath(`/instances`);
    revalidatePath(`/resources`);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Snapshot delete failed";
    await db.insert(auditLog).values({
      accountId,
      action: "instance.snapshot.delete",
      target: snapshotId,
      status: "error",
      message,
    });
    return { ok: false, error: message };
  }
}
