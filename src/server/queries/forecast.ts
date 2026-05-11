import "server-only";
import { db } from "@/lib/db";
import { snapshotHistory } from "@/lib/db/schema";
import { gte } from "drizzle-orm";

export interface ForecastPoint {
  capturedAt: Date;
  hourlyUsd: number;
}

/**
 * Simple linear-regression forecast over the last `windowDays` of
 * snapshot_history rows. Returns the slope (USD/hour per day) and the
 * projected hourly value `daysAhead` from now. Robust to tiny samples — if
 * fewer than 4 points exist we return `null`.
 */
export interface ForecastResult {
  slopeUsdPerDay: number;
  forecastHourlyUsd: number;
  pointsUsed: number;
  rangeDays: number;
}

export async function computeCostForecast(
  windowDays = 14,
  daysAhead = 7,
): Promise<ForecastResult | null> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, since));
  if (rows.length < 4) return null;

  // Aggregate to per-account-summed hourly burn at each timestamp.
  const points: ForecastPoint[] = rows.map((r) => ({ capturedAt: r.capturedAt, hourlyUsd: r.hourlyUsd }));

  // Group by hourly buckets (most recent timestamps preserved separately make
  // the regression noisy when an account is synced more often than another).
  const bucketed = new Map<number, number>();
  for (const p of points) {
    const bucket = Math.floor(p.capturedAt.getTime() / (60 * 60 * 1000));
    bucketed.set(bucket, (bucketed.get(bucket) ?? 0) + p.hourlyUsd);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [bucket, value] of bucketed) {
    xs.push(bucket);
    ys.push(value);
  }
  const n = xs.length;
  if (n < 4) return null;

  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - meanX;
    const dy = (ys[i] ?? 0) - meanY;
    num += dx * dy;
    den += dx * dx;
  }
  if (den === 0) return null;
  const slopePerHour = num / den;
  const intercept = meanY - slopePerHour * meanX;
  const futureBucket = (Date.now() + daysAhead * 24 * 60 * 60 * 1000) / (60 * 60 * 1000);
  const forecast = slopePerHour * futureBucket + intercept;

  return {
    slopeUsdPerDay: slopePerHour * 24,
    forecastHourlyUsd: Math.max(0, forecast),
    pointsUsed: n,
    rangeDays: windowDays,
  };
}
