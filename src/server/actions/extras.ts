"use server";
import "server-only";
import { z } from "zod";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { savedSearches, instanceRunbooks, instanceWebhooks, auditLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { setQuietHours, type QuietHoursConfig } from "@/lib/quiet-hours";

/* -------- saved searches -------- */
export async function createSavedSearchAction(input: { name: string; query: string; pinned?: boolean }) {
  const me = await requireRole("operator");
  const d = z.object({ name: z.string().min(1).max(80), query: z.string().min(1).max(2000), pinned: z.boolean().optional() }).parse(input);
  await db.insert(savedSearches).values({ id: nanoid(), name: d.name, query: d.query, pinned: !!d.pinned, createdBy: me?.id ?? null });
  await db.insert(auditLog).values({ action: "saved-search.create", target: d.name, status: "ok" });
  revalidatePath("/instances");
  return { ok: true as const };
}

export async function deleteSavedSearchAction(id: string) {
  await requireRole("operator");
  await db.delete(savedSearches).where(eq(savedSearches.id, id));
  await db.insert(auditLog).values({ action: "saved-search.delete", target: id, status: "ok" });
  revalidatePath("/instances");
  return { ok: true as const };
}

/* -------- runbooks -------- */
export async function upsertRunbookAction(input: { id?: string; accountId: string; providerInstanceId: string; title: string; body: string }) {
  const me = await requireRole("operator");
  const d = z.object({
    id: z.string().optional(),
    accountId: z.string().min(1),
    providerInstanceId: z.string().min(1),
    title: z.string().min(1).max(200),
    body: z.string().max(100_000),
  }).parse(input);

  if (d.id) {
    await db.update(instanceRunbooks).set({ title: d.title, body: d.body, updatedAt: new Date() }).where(eq(instanceRunbooks.id, d.id));
  } else {
    await db.insert(instanceRunbooks).values({
      id: nanoid(), accountId: d.accountId, providerInstanceId: d.providerInstanceId,
      title: d.title, body: d.body, createdBy: me?.id ?? null,
    });
  }
  await db.insert(auditLog).values({ accountId: d.accountId, action: "runbook.save", target: d.title, status: "ok" });
  revalidatePath(`/instances`);
  return { ok: true as const };
}

export async function deleteRunbookAction(id: string) {
  await requireRole("operator");
  await db.delete(instanceRunbooks).where(eq(instanceRunbooks.id, id));
  await db.insert(auditLog).values({ action: "runbook.delete", target: id, status: "ok" });
  return { ok: true as const };
}

/* -------- webhooks -------- */
export async function upsertInstanceWebhookAction(input: { id?: string; accountId?: string | null; providerInstanceId?: string | null; url: string; secret?: string | null; enabled?: boolean }) {
  await requireRole("admin");
  const d = z.object({
    id: z.string().optional(),
    accountId: z.string().nullable().optional(),
    providerInstanceId: z.string().nullable().optional(),
    url: z.string().url().max(2048),
    secret: z.string().max(512).nullable().optional(),
    enabled: z.boolean().optional(),
  }).parse(input);

  const accountId: string | null = d.accountId ?? null;
  const providerInstanceId: string | null = d.providerInstanceId ?? null;
  const secret: string | null = d.secret ?? null;
  const enabled: boolean = d.enabled ?? true;

  if (d.id) {
    await db.update(instanceWebhooks).set({
      accountId, providerInstanceId, url: d.url, secret, enabled,
    }).where(eq(instanceWebhooks.id, d.id));
  } else {
    await db.insert(instanceWebhooks).values({
      id: nanoid(), accountId, providerInstanceId, url: d.url, secret, enabled,
    });
  }
  await db.insert(auditLog).values({ action: "webhook.upsert", target: d.url, status: "ok" });
  revalidatePath("/instance-webhooks");
  return { ok: true as const };
}

export async function deleteInstanceWebhookAction(id: string) {
  await requireRole("admin");
  await db.delete(instanceWebhooks).where(eq(instanceWebhooks.id, id));
  await db.insert(auditLog).values({ action: "webhook.delete", target: id, status: "ok" });
  revalidatePath("/instance-webhooks");
  return { ok: true as const };
}

/* Fire all matching webhooks for an instance state transition. */
export async function fireWebhooksForState(args: { accountId: string; providerInstanceId: string; instanceName: string; from: string; to: string }) {
  const hooks = await db.select().from(instanceWebhooks).where(eq(instanceWebhooks.enabled, true));
  const matching = hooks.filter((h) =>
    (!h.accountId || h.accountId === args.accountId) &&
    (!h.providerInstanceId || h.providerInstanceId === args.providerInstanceId)
  );
  if (matching.length === 0) return;
  const payload = JSON.stringify({
    type: "instance.state",
    accountId: args.accountId,
    providerInstanceId: args.providerInstanceId,
    instanceName: args.instanceName,
    from: args.from, to: args.to,
    ts: new Date().toISOString(),
  });
  await Promise.all(matching.map(async (h) => {
    let signature: string | undefined;
    if (h.secret) {
      const { createHmac } = await import("node:crypto");
      signature = "sha256=" + createHmac("sha256", h.secret).update(payload).digest("hex");
    }
    const { enqueueWebhookDelivery } = await import("@/lib/webhook-queue");
    await enqueueWebhookDelivery({ webhookId: h.id, url: h.url, payload: JSON.parse(payload), signature });
    await db.update(instanceWebhooks).set({ lastFiredAt: new Date(), lastStatus: "queued" }).where(eq(instanceWebhooks.id, h.id));
  }));
}

/* -------- quiet hours -------- */
export async function saveQuietHoursAction(cfg: QuietHoursConfig) {
  await requireRole("admin");
  const d = z.object({
    enabled: z.boolean(),
    startHHMM: z.string().regex(/^\d{2}:\d{2}$/),
    endHHMM: z.string().regex(/^\d{2}:\d{2}$/),
    allowSeverities: z.array(z.enum(["error", "warning", "success", "info"])),
  }).parse(cfg);
  await setQuietHours(d);
  await db.insert(auditLog).values({ action: "quiet-hours.set", target: d.enabled ? `${d.startHHMM}-${d.endHHMM}` : "off", status: "ok" });
  revalidatePath("/settings");
  return { ok: true as const };
}
