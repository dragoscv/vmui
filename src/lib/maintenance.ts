import "server-only";
import { db } from "@/lib/db";
import { maintenanceWindows } from "@/lib/db/schema";
import { and, gte, lte, or, isNull, eq } from "drizzle-orm";

export interface ActiveWindow {
  id: string;
  name: string;
  mode: "block" | "warn";
  endsAt: Date;
  reason: string | null;
}

export async function getActiveMaintenanceWindow(accountId?: string): Promise<ActiveWindow | null> {
  const now = new Date();
  const rows = await db.select().from(maintenanceWindows)
    .where(and(
      lte(maintenanceWindows.startsAt, now),
      gte(maintenanceWindows.endsAt, now),
      accountId ? or(isNull(maintenanceWindows.accountId), eq(maintenanceWindows.accountId, accountId)) : isNull(maintenanceWindows.accountId),
    ));
  if (rows.length === 0) return null;
  const blocking = rows.find((r) => r.mode === "block") ?? rows[0]!;
  return { id: blocking.id, name: blocking.name, mode: blocking.mode, endsAt: blocking.endsAt, reason: blocking.reason };
}
