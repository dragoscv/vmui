import "server-only";
import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";

export type PushTopic = "state" | "builds" | "alerts" | "costs" | "compliance";

let configured = false;
function configure(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:vmui@localhost";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  /** Where to navigate on click. */
  url?: string;
  tag?: string;
}

/**
 * Send a push to every subscriber that opted into `topic`. Stale subscriptions
 * (HTTP 404 / 410 from the push service) are pruned automatically.
 */
export async function sendPush(topic: PushTopic, payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  if (!configure()) return { sent: 0, pruned: 0 };
  const subs = db.select().from(pushSubscriptions).all();
  const data = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;
  for (const s of subs) {
    if (!s.topics.split(",").includes(topic)) continue;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.authKey } },
        data,
      );
      sent++;
    } catch (err: unknown) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint)).run();
        pruned++;
      }
    }
  }
  return { sent, pruned };
}
