"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { cachedResources, cloudAccounts, auditLog, resourceHistory } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers/registry";
import type { ResourceKind } from "@/lib/providers/types";

function parseRegions(json: string | null, fallback: string | null): string[] {
  if (json) {
    try {
      const arr = JSON.parse(json) as unknown;
      if (Array.isArray(arr) && arr.every((s) => typeof s === "string") && arr.length > 0) {
        return Array.from(new Set(arr as string[]));
      }
    } catch {
      // fall through
    }
  }
  return [fallback ?? "us-east-1"];
}

const ALL_KINDS: ResourceKind[] = [
  "volume",
  "snapshot",
  "security-group",
  "keypair",
  "vpc",
  "subnet",
  "bucket",
  "database",
  "load-balancer",
  "dns-zone",
];

/**
 * Sync all supported resource kinds for one account in its default region.
 * Bulk-deletes existing rows for that (account, kind) pair before re-inserting,
 * so removed resources disappear from the cache.
 */
export async function syncAccountResources(accountId: string): Promise<{
  ok: boolean;
  counts?: Record<string, number>;
  error?: string;
}> {
  let provider, account;
  try {
    ({ provider, account } = await getProvider(accountId));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load provider" };
  }
  if (!provider.listResources) {
    return { ok: false, error: `Resources not yet supported for ${account.provider}` };
  }
  const regions = parseRegions(account.regions, account.defaultRegion);
  const counts: Record<string, number> = {};

  const existing = await db
    .select({
      kind: cachedResources.kind,
      externalId: cachedResources.externalId,
      region: cachedResources.region,
      rawJson: cachedResources.rawJson,
    })
    .from(cachedResources)
    .where(eq(cachedResources.accountId, accountId));
  const prevByKey = new Map<string, string | null>(
    existing.map((r) => [`${r.region}:${r.kind}:${r.externalId}`, r.rawJson]),
  );

  // Wipe everything for this account so removed regions/resources disappear.
  await db.delete(cachedResources).where(eq(cachedResources.accountId, accountId));

  const historyRows: { id: string; accountId: string; region: string; kind: string; externalId: string; prevJson: string | null; nextJson: string }[] = [];

  await Promise.all(
    regions.flatMap((region) =>
      ALL_KINDS.map(async (kind) => {
        let rows;
        try {
          rows = await provider.listResources!(region, kind);
        } catch (err) {
          counts[kind] = (counts[kind] ?? 0) - 0;
          await db.insert(auditLog).values({
            accountId,
            action: `resources.sync.${kind}`,
            target: region,
            status: "error",
            message: err instanceof Error ? err.message : "Failed",
          });
          return;
        }
        if (rows.length) {
          for (const r of rows) {
            const key = `${r.region}:${r.kind}:${r.externalId}`;
            const prev = prevByKey.get(key);
            const nextJson = JSON.stringify(r.raw);
            if (prev !== undefined && prev !== null && prev !== nextJson) {
              historyRows.push({
                id: nanoid(),
                accountId,
                region: r.region,
                kind: r.kind,
                externalId: r.externalId,
                prevJson: prev,
                nextJson,
              });
            }
          }
          await db.insert(cachedResources).values(
            rows.map((r) => ({
              id: `${accountId}:${r.region}:${r.kind}:${r.externalId}`,
              accountId,
              provider: account.provider,
              region: r.region,
              kind: r.kind,
              externalId: r.externalId,
              name: r.name,
              status: r.status,
              sizeBytes: r.sizeBytes ?? null,
              attachedToInstanceId: r.attachedTo ?? null,
              monthlyUsd: null,
              rawJson: JSON.stringify(r.raw),
              lastSyncedAt: new Date(),
            })),
          );
        }
        counts[kind] = (counts[kind] ?? 0) + rows.length;
      }),
    ),
  );

  if (historyRows.length) {
    await db.insert(resourceHistory).values(historyRows);
  }

  await db.insert(auditLog).values({
    accountId,
    action: "resources.sync",
    target: account.provider,
    status: "ok",
    message: Object.entries(counts)
      .map(([k, n]) => `${k}:${n}`)
      .join(", "),
  });

  revalidatePath("/resources");
  return { ok: true, counts };
}

/** Sync resources for every configured account that supports it. */
export async function syncAllResources(): Promise<{ ok: boolean; total: number }> {
  const accounts = await db.select().from(cloudAccounts);
  let total = 0;
  for (const a of accounts) {
    const r = await syncAccountResources(a.id);
    if (r.ok && r.counts) total += Object.values(r.counts).reduce((s, n) => s + (n > 0 ? n : 0), 0);
  }
  revalidatePath("/resources");
  return { ok: true, total };
}
