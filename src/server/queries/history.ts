import "server-only";
import { db } from "@/lib/db";
import { snapshotHistory } from "@/lib/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";

export async function listAccountHistory(accountId: string, sinceMs = 7 * 24 * 60 * 60 * 1000) {
  const since = new Date(Date.now() - sinceMs);
  return db
    .select()
    .from(snapshotHistory)
    .where(and(eq(snapshotHistory.accountId, accountId), gte(snapshotHistory.capturedAt, since)))
    .orderBy(desc(snapshotHistory.capturedAt));
}
