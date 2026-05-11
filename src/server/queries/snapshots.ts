import "server-only";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { cachedResources, cloudAccounts } from "@/lib/db/schema";

export interface SnapshotEvent {
  id: string;
  accountId: string;
  accountName: string;
  provider: string;
  region: string;
  externalId: string;
  name: string | null;
  status: string | null;
  sizeBytes: number | null;
  attachedToInstanceId: string | null;
  /** ms epoch, parsed from rawJson when available, else lastSyncedAt. */
  capturedAt: number;
}

const SNAPSHOT_DATE_KEYS = [
  "created_at",
  "createdAt",
  "creationTime",
  "creationTimestamp",
  "StartTime",
  "TimeCreated",
];

function parseRawDate(rawJson: string | null, fallbackMs: number): number {
  if (!rawJson) return fallbackMs;
  try {
    const obj = JSON.parse(rawJson) as Record<string, unknown>;
    for (const key of SNAPSHOT_DATE_KEYS) {
      const v = obj[key];
      if (typeof v === "string") {
        const ms = Date.parse(v);
        if (!Number.isNaN(ms)) return ms;
      } else if (typeof v === "number" && v > 1_000_000_000) {
        return v < 1e12 ? v * 1000 : v;
      }
    }
  } catch {
    // ignore
  }
  return fallbackMs;
}

/** All snapshots across accounts, normalized for the calendar/timeline UIs. */
export async function listSnapshotEvents(): Promise<SnapshotEvent[]> {
  const rows = await db
    .select({
      r: cachedResources,
      accName: cloudAccounts.name,
    })
    .from(cachedResources)
    .innerJoin(cloudAccounts, eq(cloudAccounts.id, cachedResources.accountId))
    .where(eq(cachedResources.kind, "snapshot"))
    .orderBy(desc(cachedResources.lastSyncedAt));

  return rows.map(({ r, accName }) => ({
    id: r.id,
    accountId: r.accountId,
    accountName: accName,
    provider: r.provider,
    region: r.region,
    externalId: r.externalId,
    name: r.name,
    status: r.status,
    sizeBytes: r.sizeBytes ?? null,
    attachedToInstanceId: r.attachedToInstanceId ?? null,
    capturedAt: parseRawDate(r.rawJson, r.lastSyncedAt.getTime()),
  }));
}
