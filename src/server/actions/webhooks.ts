"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog, webhookDeliveries, webhooks, type WebhookRow } from "@/lib/db/schema";
import { deliverOnce } from "@/lib/webhook-queue";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import "server-only";
import { z } from "zod";

const KINDS = ["slack", "discord", "generic"] as const;
const CHANNELS = [
  "instance.changed",
  "sync.completed",
  "snapshot.created",
  "notification.created",
] as const;

const schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(80),
  url: z
    .url()
    .refine((u) => u.startsWith("https://"), "URL must use https://"),
  kind: z.enum(KINDS),
  channels: z.array(z.enum(CHANNELS)).min(1),
  enabled: z.boolean(),
  cooldownSec: z.number().int().min(0).max(86_400).nullable().optional(),
});

export async function listWebhooksAction(): Promise<WebhookRow[]> {
  return db.select().from(webhooks);
}

export interface WebhookDelivery {
  id: number;
  createdAt: Date;
  status: string;
  message: string | null;
}

export async function recentWebhookDeliveriesAction(
  webhookId: string,
  limit = 5,
): Promise<WebhookDelivery[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      status: auditLog.status,
      message: auditLog.message,
    })
    .from(auditLog)
    .where(and(eq(auditLog.action, "webhook.delivery"), eq(auditLog.target, webhookId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows;
}

export async function upsertWebhookAction(
  input: z.infer<typeof schema>,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { id, name, url, kind, channels, enabled, cooldownSec } = parsed.data;
  const channelsJson = JSON.stringify(channels);
  const cd = cooldownSec ?? null;
  if (id) {
    await db
      .update(webhooks)
      .set({ name, url, kind, channels: channelsJson, enabled: enabled ? 1 : 0, cooldownSec: cd })
      .where(eq(webhooks.id, id));
    revalidatePath("/settings");
    return { ok: true, id };
  }
  const newId = nanoid();
  await db.insert(webhooks).values({
    id: newId,
    name,
    url,
    kind,
    channels: channelsJson,
    enabled: enabled ? 1 : 0,
    cooldownSec: cd,
  });
  await db.insert(auditLog).values({
    action: "webhook.create",
    target: newId,
    status: "ok",
    message: `${kind} → ${name}`,
  });
  revalidatePath("/settings");
  return { ok: true, id: newId };
}

export async function deleteWebhookAction(id: string): Promise<{ ok: boolean }> {
  try { await requireRole("operator"); } catch { return { ok: false }; }
  await db.delete(webhooks).where(eq(webhooks.id, id));
  await db.insert(auditLog).values({ action: "webhook.delete", target: id, status: "ok" });
  revalidatePath("/settings");
  return { ok: true };
}

const testSchema = z.object({
  id: z.string().min(1),
});

export async function testWebhookAction(
  input: z.infer<typeof testSchema>,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid id" };
  const row = await db.query.webhooks.findFirst({ where: eq(webhooks.id, parsed.data.id) });
  if (!row) return { ok: false, error: "Webhook not found" };
  const body =
    row.kind === "slack"
      ? { text: `*vmui* test ping at ${new Date().toISOString()}` }
      : row.kind === "discord"
        ? { content: `**vmui** test ping at ${new Date().toISOString()}` }
        : { source: "vmui", channel: "test", payload: {}, summary: "test ping" };
  try {
    const res = await fetch(row.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const status = `${res.status}`;
    await db
      .update(webhooks)
      .set({ lastFiredAt: new Date(), lastStatus: status })
      .where(eq(webhooks.id, row.id));
    await db.insert(auditLog).values({
      action: "webhook.test",
      target: row.id,
      status: res.ok ? "ok" : "error",
      message: `HTTP ${status}`,
    });
    return { ok: res.ok, status };
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    await db.insert(auditLog).values({ action: "webhook.test", target: row.id, status: "error", message });
    return { ok: false, error: message };
  }
}

export async function retryWebhookDeliveryAction(
  id: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = z.string().min(1).safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid id" };
  const row = (await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, parsed.data)).limit(1))[0];
  if (!row) return { ok: false, error: "Delivery not found" };
  const retryable =
    row.status === "failed" || (row.status === "queued" && row.nextAttemptAt.getTime() > Date.now());
  if (!retryable) return { ok: false, error: "notRetryable" };

  await db.update(webhookDeliveries).set({ status: "delivering" }).where(eq(webhookDeliveries.id, row.id));
  const r = await deliverOnce(row);
  if (r.ok) {
    await db
      .update(webhookDeliveries)
      .set({ status: "ok", deliveredAt: new Date(), attempts: row.attempts + 1, lastErrorMessage: null })
      .where(eq(webhookDeliveries.id, row.id));
  } else {
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", attempts: row.attempts + 1, lastErrorMessage: r.error ?? "fetch failed" })
      .where(eq(webhookDeliveries.id, row.id));
  }
  await db.insert(auditLog).values({
    action: "webhook.delivery.retry",
    target: row.webhookId,
    status: r.ok ? "ok" : "error",
    message: `${row.url} → ${r.ok ? `HTTP ${r.status}` : (r.error ?? "fetch failed")}`,
  });
  revalidatePath("/webhook-deliveries");
  return r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, error: r.error ?? "fetch failed" };
}
