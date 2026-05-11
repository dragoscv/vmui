import "server-only";
import { db } from "@/lib/db";
import { snapshotHistory, settings, auditLog } from "@/lib/db/schema";
import { gte, eq } from "drizzle-orm";
import { notify } from "@/lib/notifications";

const KEY = "burn_rate_threshold_daily_usd";

export async function getBurnRateThreshold(): Promise<number> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
  if (!row) return 0;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : 0;
}

export async function setBurnRateThreshold(usd: number): Promise<void> {
  const v = String(Math.max(0, usd));
  const [existing] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
  if (existing) {
    await db.update(settings).set({ value: v }).where(eq(settings.key, KEY));
  } else {
    await db.insert(settings).values({ key: KEY, value: v });
  }
}

export interface BurnReport {
  thresholdUsd: number;
  projectedDailyUsd: number;
  projectedMonthlyUsd: number;
  exceeded: boolean;
}

/** Project today's burn rate from the most recent fleet snapshot. */
export async function computeBurnRate(): Promise<BurnReport> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const rows = await db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, since));
  // Average the per-account hourly rate across all samples in the last 24h then
  // group by account+capturedAt bucket to avoid double-count when many syncs happen.
  if (rows.length === 0) {
    const t = await getBurnRateThreshold();
    return { thresholdUsd: t, projectedDailyUsd: 0, projectedMonthlyUsd: 0, exceeded: false };
  }
  const byAccount = new Map<string, number>();
  for (const r of rows) {
    const cur = byAccount.get(r.accountId) ?? 0;
    if (r.hourlyUsd > cur) byAccount.set(r.accountId, r.hourlyUsd);
  }
  const peakHourly = Array.from(byAccount.values()).reduce((s, v) => s + v, 0);
  const daily = peakHourly * 24;
  const monthly = peakHourly * 24 * 30;
  const threshold = await getBurnRateThreshold();
  return {
    thresholdUsd: threshold,
    projectedDailyUsd: daily,
    projectedMonthlyUsd: monthly,
    exceeded: threshold > 0 && daily > threshold,
  };
}

let lastAlert = 0;
const ALERT_COOLDOWN_MS = 6 * 3600_000; // 6h

export async function maybeAlertBurnRate(): Promise<{ alerted: boolean; report: BurnReport }> {
  const report = await computeBurnRate();
  const now = Date.now();
  if (!report.exceeded || now - lastAlert < ALERT_COOLDOWN_MS) return { alerted: false, report };
  lastAlert = now;
  await notify({
    severity: "warning",
    category: "cost",
    title: "Daily burn rate exceeded",
    body: `Projected daily spend $${report.projectedDailyUsd.toFixed(2)} > threshold $${report.thresholdUsd.toFixed(2)}.`,
  });
  await db.insert(auditLog).values({ action: "burn-rate.alert", target: `${report.projectedDailyUsd.toFixed(2)} usd/day`, status: "ok" });
  return { alerted: true, report };
}
