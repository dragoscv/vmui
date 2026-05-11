"use server";

import { db } from "@/lib/db";
import {
  cachedResources,
  cloudAccounts,
  instanceTags,
  instances,
  type CachedResourceRow,
  type CloudAccountRow,
  type InstanceRow,
  type InstanceTagRow,
} from "@/lib/db/schema";
import { desc } from "drizzle-orm";

/**
 * Lightweight instance list for the command palette. Returns a slice of
 * fields needed to render and run actions; avoids leaking rawJson.
 */
export async function listInstancesForPalette(): Promise<InstanceRow[]> {
  const rows = await db
    .select()
    .from(instances)
    .orderBy(desc(instances.lastSyncedAt))
    .limit(200);
  return rows;
}

export interface PaletteIndex {
  instances: InstanceRow[];
  resources: Pick<CachedResourceRow, "id" | "accountId" | "provider" | "region" | "kind" | "externalId" | "name">[];
  accounts: Pick<CloudAccountRow, "id" | "provider" | "name" | "defaultRegion">[];
  tags: Pick<InstanceTagRow, "key" | "value" | "instanceId">[];
}

export async function listPaletteIndex(): Promise<PaletteIndex> {
  const [is, rs, as, ts] = await Promise.all([
    db.select().from(instances).orderBy(desc(instances.lastSyncedAt)).limit(200),
    db
      .select({
        id: cachedResources.id,
        accountId: cachedResources.accountId,
        provider: cachedResources.provider,
        region: cachedResources.region,
        kind: cachedResources.kind,
        externalId: cachedResources.externalId,
        name: cachedResources.name,
      })
      .from(cachedResources)
      .limit(500),
    db
      .select({
        id: cloudAccounts.id,
        provider: cloudAccounts.provider,
        name: cloudAccounts.name,
        defaultRegion: cloudAccounts.defaultRegion,
      })
      .from(cloudAccounts),
    db
      .select({
        key: instanceTags.key,
        value: instanceTags.value,
        instanceId: instanceTags.instanceId,
      })
      .from(instanceTags)
      .limit(500),
  ]);
  return { instances: is, resources: rs, accounts: as, tags: ts };
}
