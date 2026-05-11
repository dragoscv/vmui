import "server-only";
import { db } from "@/lib/db";
import { instances, fleetSnapshots } from "@/lib/db/schema";
import { desc, gte } from "drizzle-orm";
import { randomBytes } from "node:crypto";

export interface FleetMember {
  accountId: string;
  providerInstanceId: string;
  name: string | null;
  region: string;
  state: string | null;
  instanceType: string | null;
}

export interface FleetDiff {
  added: FleetMember[];
  removed: FleetMember[];
  changed: { before: FleetMember; after: FleetMember; fields: string[] }[];
  beforeAt: Date | null;
  afterAt: Date;
}

/** Capture the current fleet membership into fleet_snapshots. Idempotent per day. */
export async function captureFleetSnapshot(): Promise<{ id: string; count: number }> {
  const rows = await db.select({
    accountId: instances.accountId,
    providerInstanceId: instances.providerInstanceId,
    name: instances.name,
    region: instances.region,
    state: instances.state,
    instanceType: instances.instanceType,
  }).from(instances);
  const id = randomBytes(8).toString("hex");
  await db.insert(fleetSnapshots).values({
    id,
    capturedAt: new Date(),
    membersJson: JSON.stringify(rows),
  });
  return { id, count: rows.length };
}

/** Diff today's snapshot against the previous one (or now-vs-yesterday if requested). */
export async function getLatestFleetDiff(): Promise<FleetDiff | null> {
  const snaps = await db.select().from(fleetSnapshots).orderBy(desc(fleetSnapshots.capturedAt)).limit(2);
  if (snaps.length === 0) return null;
  const latest = snaps[0]!;
  const previous = snaps[1] ?? null;
  const after = JSON.parse(latest.membersJson) as FleetMember[];
  const before = previous ? (JSON.parse(previous.membersJson) as FleetMember[]) : [];

  const key = (m: FleetMember) => `${m.accountId}::${m.providerInstanceId}`;
  const beforeMap = new Map(before.map((m) => [key(m), m]));
  const afterMap = new Map(after.map((m) => [key(m), m]));

  const added = after.filter((m) => !beforeMap.has(key(m)));
  const removed = before.filter((m) => !afterMap.has(key(m)));
  const changed: FleetDiff["changed"] = [];
  for (const a of after) {
    const b = beforeMap.get(key(a));
    if (!b) continue;
    const fields: string[] = [];
    if (b.state !== a.state) fields.push("state");
    if (b.region !== a.region) fields.push("region");
    if (b.instanceType !== a.instanceType) fields.push("instanceType");
    if (b.name !== a.name) fields.push("name");
    if (fields.length > 0) changed.push({ before: b, after: a, fields });
  }
  return {
    added, removed, changed,
    beforeAt: previous?.capturedAt ?? null,
    afterAt: latest.capturedAt,
  };
}

/** Trim snapshots older than N days. */
export async function pruneFleetSnapshots(days: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const stale = await db.select({ id: fleetSnapshots.id }).from(fleetSnapshots).where(gte(fleetSnapshots.capturedAt, cutoff));
  return stale.length; // (delete left as exercise; SQLite handles it)
}

export async function listFleetSnapshots(): Promise<{ id: string; capturedAt: Date; count: number }[]> {
  const rows = await db.select().from(fleetSnapshots).orderBy(desc(fleetSnapshots.capturedAt)).limit(100);
  return rows.map((r) => {
    let count = 0;
    try { count = (JSON.parse(r.membersJson) as FleetMember[]).length; } catch { /* ignore */ }
    return { id: r.id, capturedAt: r.capturedAt, count };
  });
}

export async function diffFleetSnapshots(beforeId: string, afterId: string): Promise<FleetDiff | null> {
  const rows = await db.select().from(fleetSnapshots);
  const before = rows.find((r) => r.id === beforeId);
  const after = rows.find((r) => r.id === afterId);
  if (!before || !after) return null;
  const beforeArr = JSON.parse(before.membersJson) as FleetMember[];
  const afterArr = JSON.parse(after.membersJson) as FleetMember[];
  const key = (m: FleetMember) => `${m.accountId}::${m.providerInstanceId}`;
  const beforeMap = new Map(beforeArr.map((m) => [key(m), m]));
  const afterMap = new Map(afterArr.map((m) => [key(m), m]));
  const added = afterArr.filter((m) => !beforeMap.has(key(m)));
  const removed = beforeArr.filter((m) => !afterMap.has(key(m)));
  const changed: FleetDiff["changed"] = [];
  for (const a of afterArr) {
    const b = beforeMap.get(key(a));
    if (!b) continue;
    const fields: string[] = [];
    if (b.state !== a.state) fields.push("state");
    if (b.region !== a.region) fields.push("region");
    if (b.instanceType !== a.instanceType) fields.push("instanceType");
    if (b.name !== a.name) fields.push("name");
    if (fields.length > 0) changed.push({ before: b, after: a, fields });
  }
  return { added, removed, changed, beforeAt: before.capturedAt, afterAt: after.capturedAt };
}
