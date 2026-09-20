"use server";
import "server-only";
import { z } from "zod";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { instanceSecrets, tagPolicies, instanceTrash, auditLog } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { encryptJSON, decryptJSON } from "@/lib/crypto";
import { restoreInstanceFromSnapshotAction } from "@/server/actions/snapshots";

/* -------- secrets vault -------- */
export async function setInstanceSecretAction(input: { accountId: string; providerInstanceId: string; key: string; value: string }) {
  const me = await requireRole("operator");
  const d = z.object({
    accountId: z.string().min(1),
    providerInstanceId: z.string().min(1),
    key: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "key must be SHELL_LIKE_CAPS").max(80),
    value: z.string().max(8192),
  }).parse(input);
  const valueEnc = encryptJSON({ v: d.value });
  const existing = await db.select().from(instanceSecrets)
    .where(and(eq(instanceSecrets.accountId, d.accountId), eq(instanceSecrets.providerInstanceId, d.providerInstanceId), eq(instanceSecrets.key, d.key)))
    .limit(1);
  if (existing[0]) {
    await db.update(instanceSecrets).set({ valueEnc, updatedAt: new Date() }).where(eq(instanceSecrets.id, existing[0].id));
  } else {
    await db.insert(instanceSecrets).values({
      id: nanoid(), accountId: d.accountId, providerInstanceId: d.providerInstanceId,
      key: d.key, valueEnc, createdBy: me?.id ?? null,
    });
  }
  await db.insert(auditLog).values({ accountId: d.accountId, action: "secret.set", target: `${d.providerInstanceId}/${d.key}`, status: "ok" });
  revalidatePath(`/instances/${encodeURIComponent(d.providerInstanceId)}`);
  return { ok: true as const };
}

export async function deleteInstanceSecretAction(id: string) {
  await requireRole("operator");
  await db.delete(instanceSecrets).where(eq(instanceSecrets.id, id));
  await db.insert(auditLog).values({ action: "secret.delete", target: id, status: "ok" });
  return { ok: true as const };
}

/** Server-side getter: returns plaintext secrets for an instance (use carefully). */
export async function getInstanceSecretsPlain(args: { accountId: string; providerInstanceId: string }): Promise<Record<string, string>> {
  await requireRole("operator");
  const rows = await db.select().from(instanceSecrets)
    .where(and(eq(instanceSecrets.accountId, args.accountId), eq(instanceSecrets.providerInstanceId, args.providerInstanceId)));
  const out: Record<string, string> = {};
  for (const r of rows) {
    try {
      const decoded = decryptJSON<{ v: string }>(r.valueEnc);
      if (decoded) out[r.key] = decoded.v;
    } catch { /* skip */ }
  }
  return out;
}

/* -------- tag policies -------- */
export async function upsertTagPolicyAction(input: { id?: string; name: string; condition: string; requireKeys: string[]; enabled?: boolean }) {
  await requireRole("admin");
  const d = z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(120),
    condition: z.string().min(1).max(2000),
    requireKeys: z.array(z.string().min(1).max(80)).min(1),
    enabled: z.boolean().optional(),
  }).parse(input);
  const requireKeysJson = JSON.stringify(d.requireKeys);
  if (d.id) {
    await db.update(tagPolicies).set({
      name: d.name, condition: d.condition, requireKeysJson, enabled: d.enabled ?? true,
    }).where(eq(tagPolicies.id, d.id));
  } else {
    await db.insert(tagPolicies).values({
      id: nanoid(), name: d.name, condition: d.condition, requireKeysJson, enabled: d.enabled ?? true,
    });
  }
  await db.insert(auditLog).values({ action: "tag-policy.upsert", target: d.name, status: "ok" });
  revalidatePath("/tag-policies");
  return { ok: true as const };
}

export async function deleteTagPolicyAction(id: string) {
  await requireRole("admin");
  await db.delete(tagPolicies).where(eq(tagPolicies.id, id));
  await db.insert(auditLog).values({ action: "tag-policy.delete", target: id, status: "ok" });
  revalidatePath("/tag-policies");
  return { ok: true as const };
}

/* -------- trash -------- */
export async function deleteFromTrashAction(id: string) {
  await requireRole("admin");
  const d = z.string().min(1).parse(id);
  await db.delete(instanceTrash).where(eq(instanceTrash.id, d));
  await db.insert(auditLog).values({ action: "trash.purge", target: d, status: "ok" });
  revalidatePath("/trash");
  return { ok: true as const };
}

const RESTORABLE_PROVIDERS = new Set(["aws", "azure", "gcp"]);

export type RestoreFromTrashResult =
  | { ok: true; instanceId: string }
  | { ok: false; error: "notFound" | "unsupportedProvider" | "noSnapshot" | string };

/** Relaunch a trashed VM from its safe-terminate snapshot; drops the trash row on success. */
export async function restoreFromTrashAction(input: {
  id: string;
  instanceType?: string;
  snapshotId?: string;
}): Promise<RestoreFromTrashResult> {
  await requireRole("operator");
  const d = z.object({
    id: z.string().min(1),
    instanceType: z.string().min(1).max(64).optional(),
    snapshotId: z.string().min(1).max(512).optional(),
  }).parse(input);

  const row = (await db.select().from(instanceTrash).where(eq(instanceTrash.id, d.id)).limit(1))[0];
  if (!row) return { ok: false, error: "notFound" };
  if (!RESTORABLE_PROVIDERS.has(row.provider)) return { ok: false, error: "unsupportedProvider" };

  let snapshotId = d.snapshotId ?? row.safeSnapshotId ?? null;
  if (!snapshotId) {
    const audit = (await db.select({ message: auditLog.message }).from(auditLog)
      .where(and(
        eq(auditLog.action, "instance.terminate.safe-snapshot"),
        eq(auditLog.status, "ok"),
        eq(auditLog.target, row.providerInstanceId),
      ))
      .orderBy(desc(auditLog.createdAt))
      .limit(1))[0];
    snapshotId = audit?.message ?? null;
  }
  if (!snapshotId) return { ok: false, error: "noSnapshot" };

  const res = await restoreInstanceFromSnapshotAction({
    accountId: row.accountId,
    region: row.region,
    snapshotId,
    label: row.name ?? row.providerInstanceId,
    instanceType: d.instanceType ?? row.instanceType ?? "",
  });
  if (!res.ok) {
    await db.insert(auditLog).values({
      accountId: row.accountId, action: "trash.restore", target: row.providerInstanceId, status: "error", message: res.error,
    });
    return { ok: false, error: res.error };
  }

  await db.delete(instanceTrash).where(eq(instanceTrash.id, row.id));
  await db.insert(auditLog).values({
    accountId: row.accountId, action: "trash.restore", target: row.providerInstanceId, status: "ok", message: res.providerInstanceId,
  });
  revalidatePath("/trash");
  revalidatePath("/instances");
  revalidatePath("/");
  return { ok: true, instanceId: res.providerInstanceId };
}
