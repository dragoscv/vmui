"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import {
  dismissAll,
  dismissNotification,
  listNotifications,
  markAllSeen,
} from "@/lib/notifications";
import type { NotificationRow } from "@/lib/db/schema";

export async function listNotificationsAction(opts?: {
  includeDismissed?: boolean;
}): Promise<NotificationRow[]> {
  return listNotifications({ includeDismissed: opts?.includeDismissed, limit: 100 });
}

export async function markAllSeenAction(): Promise<void> {
  await markAllSeen();
}

export async function dismissNotificationAction(id: string): Promise<void> {
  await dismissNotification(id);
  revalidatePath("/");
}

export async function dismissAllNotificationsAction(): Promise<void> {
  await dismissAll();
  revalidatePath("/");
}
