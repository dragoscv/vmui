"use server";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resourceHistory } from "@/lib/db/schema";

export async function listResourceHistoryAction(input: {
  accountId: string;
  kind: string;
  externalId: string;
  limit?: number;
}) {
  const rows = await db
    .select()
    .from(resourceHistory)
    .where(
      and(
        eq(resourceHistory.accountId, input.accountId),
        eq(resourceHistory.kind, input.kind),
        eq(resourceHistory.externalId, input.externalId),
      ),
    )
    .orderBy(desc(resourceHistory.capturedAt))
    .limit(input.limit ?? 20);
  return rows.map((r) => ({
    id: r.id,
    region: r.region,
    capturedAt: r.capturedAt,
    prevJson: r.prevJson,
    nextJson: r.nextJson,
  }));
}
