import "server-only";
import { db } from "@/lib/db";
import { instances, probeSamples, auditLog, settings } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { notify } from "@/lib/notifications";

const KEY = "disk_watchdog_threshold_pct";
const ALERT_TTL_MS = 12 * 3600_000;

const _alerted = new Map<string, number>();

export async function getDiskThreshold(): Promise<number> {
  const row = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
  const n = row[0] ? Number(row[0].value) : 90;
  return Number.isFinite(n) ? n : 90;
}

export async function setDiskThreshold(pct: number): Promise<void> {
  const value = String(Math.max(50, Math.min(99, Math.round(pct))));
  const existing = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
  if (existing[0]) {
    await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, KEY));
  } else {
    await db.insert(settings).values({ key: KEY, value });
  }
}

let _lastRun = 0;
export async function maybeRunDiskWatchdog() {
  const now = Date.now();
  if (now - _lastRun < 30 * 60_000) return;
  _lastRun = now;
  const threshold = await getDiskThreshold();
  const all = await db.select().from(instances);
  for (const inst of all) {
    const last = _alerted.get(inst.id) ?? 0;
    if (now - last < ALERT_TTL_MS) continue;
    const samples = await db.select().from(probeSamples).where(eq(probeSamples.instanceId, inst.id))
      .orderBy(desc(probeSamples.collectedAt)).limit(1);
    const s = samples[0];
    if (!s) continue;
    let disk: number | undefined;
    try { disk = (JSON.parse(s.metricsJson) as { disk?: number }).disk; } catch { /* ignore */ }
    if (typeof disk !== "number") continue;
    if (disk < threshold) continue;
    _alerted.set(inst.id, now);
    await notify({
      category: "instance", severity: disk >= 95 ? "error" : "warning",
      title: `Disk ${disk.toFixed(0)}%: ${inst.name ?? inst.providerInstanceId}`,
      body: `Disk usage above ${threshold}% threshold.`,
      href: `/instances/${encodeURIComponent(inst.id)}`,
      accountId: inst.accountId,
    });
    await db.insert(auditLog).values({
      accountId: inst.accountId, action: "disk.alert", target: inst.providerInstanceId,
      status: "ok", message: `${disk.toFixed(1)}% >= ${threshold}%`,
    });
  }
}
