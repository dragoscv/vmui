"use server";

import "server-only";
import { and, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cachedResources } from "@/lib/db/schema";

const schema = z.object({
  accountId: z.string().min(1),
  region: z.string().min(1),
  providerInstanceId: z.string().min(1),
});

export interface SnapshotFreshness {
  hasRecent: boolean;
  hasAny: boolean;
  lastSnapshotAt: number | null;
  daysSince: number | null;
}

const RECENT_DAYS = 7;

/**
 * Look up snapshots that appear to belong to a given instance based on the
 * provider-side naming convention (the snapshot name or external id
 * contains the instance id). Returns a coarse freshness summary the UI
 * uses to warn before terminating.
 */
export async function checkSnapshotFreshness(
  input: z.infer<typeof schema>,
): Promise<SnapshotFreshness> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { hasRecent: false, hasAny: false, lastSnapshotAt: null, daysSince: null };
  }
  const { accountId, region, providerInstanceId } = parsed.data;
  const idFragment = `%${providerInstanceId}%`;
  const rows = await db
    .select()
    .from(cachedResources)
    .where(
      and(
        eq(cachedResources.accountId, accountId),
        eq(cachedResources.region, region),
        eq(cachedResources.kind, "snapshot"),
        or(like(cachedResources.name, idFragment), like(cachedResources.externalId, idFragment)),
      ),
    );
  if (rows.length === 0) {
    return { hasRecent: false, hasAny: false, lastSnapshotAt: null, daysSince: null };
  }
  const newest = rows.reduce(
    (acc, r) => (r.lastSyncedAt.getTime() > acc ? r.lastSyncedAt.getTime() : acc),
    0,
  );
  const daysSince = (Date.now() - newest) / (24 * 60 * 60 * 1000);
  return {
    hasRecent: daysSince <= RECENT_DAYS,
    hasAny: true,
    lastSnapshotAt: newest,
    daysSince: Math.round(daysSince * 10) / 10,
  };
}
