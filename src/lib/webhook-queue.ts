import "server-only";
import { db } from "@/lib/db";
import { webhookDeliveries } from "@/lib/db/schema";
import { and, eq, lte } from "drizzle-orm";
import { nanoid } from "nanoid";

export interface EnqueueInput {
  webhookId: string;
  url: string;
  payload: unknown;
  signature?: string;
  maxAttempts?: number;
}

export async function enqueueWebhookDelivery(input: EnqueueInput): Promise<string> {
  const id = nanoid();
  await db.insert(webhookDeliveries).values({
    id,
    webhookId: input.webhookId,
    url: input.url,
    payloadJson: JSON.stringify(input.payload),
    signature: input.signature ?? null,
    maxAttempts: input.maxAttempts ?? 5,
    status: "queued",
    nextAttemptAt: new Date(),
  });
  return id;
}

let lastTick = 0;
export async function maybeFlushWebhookDeliveries(): Promise<void> {
  const now = Date.now();
  if (now - lastTick < 30_000) return;
  lastTick = now;

  const due = await db.select().from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, "queued"), lte(webhookDeliveries.nextAttemptAt, new Date())))
    .limit(50);

  for (const d of due) {
    await db.update(webhookDeliveries).set({ status: "delivering" }).where(eq(webhookDeliveries.id, d.id));
    let ok = false;
    let err: string | null = null;
    try {
      const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "vmui-webhook/1" };
      if (d.signature) headers["x-vmui-signature"] = d.signature;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(d.url, { method: "POST", headers, body: d.payloadJson, signal: ctrl.signal });
      clearTimeout(t);
      ok = res.ok;
      if (!ok) err = `HTTP ${res.status}`;
    } catch (e) {
      err = e instanceof Error ? e.message : "fetch failed";
    }

    if (ok) {
      await db.update(webhookDeliveries).set({ status: "ok", deliveredAt: new Date(), attempts: d.attempts + 1 })
        .where(eq(webhookDeliveries.id, d.id));
    } else {
      const attempts = d.attempts + 1;
      const failed = attempts >= d.maxAttempts;
      const backoffSec = Math.min(3600, 30 * 2 ** attempts);
      await db.update(webhookDeliveries).set({
        status: failed ? "failed" : "queued",
        attempts,
        lastErrorMessage: err,
        nextAttemptAt: new Date(Date.now() + backoffSec * 1000),
      }).where(eq(webhookDeliveries.id, d.id));
    }
  }
}
