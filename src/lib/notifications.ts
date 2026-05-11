import "server-only";

import { nanoid } from "nanoid";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, type NotificationRow } from "@/lib/db/schema";
import { publishEvent } from "@/lib/event-bus";

export type NotificationSeverity = NotificationRow["severity"];
export type NotificationCategory =
  | "auth"
  | "cost"
  | "compliance"
  | "schedule"
  | "sync"
  | "instance"
  | "system";

export interface NotifyInput {
  category: NotificationCategory;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  href?: string | null;
  accountId?: string | null;
}

/**
 * Persist a notification and fan it out over the SSE event bus so connected
 * clients can update their bell counter without a refresh. Failures are
 * swallowed — a missing notification must never break a real action.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const id = nanoid();
    await db.insert(notifications).values({
      id,
      category: input.category,
      severity: input.severity ?? "info",
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      accountId: input.accountId ?? null,
    });
    publishEvent({
      channel: "notification.created",
      payload: {
        id,
        category: input.category,
        severity: input.severity ?? "info",
        title: input.title,
      },
    });
  } catch {
    /* never throw */
  }
}

export async function listNotifications(opts?: {
  includeDismissed?: boolean;
  limit?: number;
}): Promise<NotificationRow[]> {
  const limit = opts?.limit ?? 50;
  const where = opts?.includeDismissed ? undefined : isNull(notifications.dismissedAt);
  const q = db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit);
  return where ? q.where(where) : q;
}

export async function countUnseen(): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(isNull(notifications.seenAt), isNull(notifications.dismissedAt)));
  return rows.length;
}

export async function markAllSeen(): Promise<void> {
  await db
    .update(notifications)
    .set({ seenAt: new Date() })
    .where(isNull(notifications.seenAt));
}

export async function dismissNotification(id: string): Promise<void> {
  await db
    .update(notifications)
    .set({ dismissedAt: new Date() })
    .where(eq(notifications.id, id));
}

export async function dismissAll(): Promise<void> {
  await db
    .update(notifications)
    .set({ dismissedAt: new Date() })
    .where(isNull(notifications.dismissedAt));
}

/** Trim notifications older than `days` to keep the table bounded. */
export async function pruneOldNotifications(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const res = await db.delete(notifications).where(lt(notifications.createdAt, cutoff));
  return (res as { changes?: number }).changes ?? 0;
}
