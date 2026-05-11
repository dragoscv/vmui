import "server-only";
import { db } from "@/lib/db";
import { snapshotHistory } from "@/lib/db/schema";
import { gte, asc } from "drizzle-orm";

export interface ForecastPoint { day: string; actualUsd: number | null; projectedUsd: number | null; }

/**
 * Linear regression on snapshot_history.hourlyUsd over the last N days,
 * projected forward `forwardDays`. Returns a flat array suitable for charting.
 */
export async function buildCostForecast(historyDays = 30, forwardDays = 30): Promise<{ points: ForecastPoint[]; slopeUsdPerDay: number; r2: number; }> {
  const since = new Date(Date.now() - historyDays * 86_400_000);
  const rows = db
    .select()
    .from(snapshotHistory)
    .where(gte(snapshotHistory.capturedAt, since))
    .orderBy(asc(snapshotHistory.capturedAt))
    .all();

  // bucket per UTC day, average hourlyUsd then *24 for daily $
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const day = r.capturedAt.toISOString().slice(0, 10);
    const arr = byDay.get(day) ?? [];
    arr.push(r.hourlyUsd);
    byDay.set(day, arr);
  }
  const history = Array.from(byDay.entries())
    .map(([day, arr]) => ({ day, usd: (arr.reduce((s, v) => s + v, 0) / arr.length) * 24 }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // linear regression on (idx, usd)
  const n = history.length;
  let slope = 0, intercept = 0, r2 = 0;
  if (n >= 2) {
    const xs = history.map((_, i) => i);
    const ys = history.map((p) => p.usd);
    const xMean = xs.reduce((s, v) => s + v, 0) / n;
    const yMean = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i]! - xMean) * (ys[i]! - yMean);
      den += (xs[i]! - xMean) ** 2;
    }
    slope = den > 0 ? num / den : 0;
    intercept = yMean - slope * xMean;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
      const yi = ys[i]!;
      const yhat = intercept + slope * xs[i]!;
      ssTot += (yi - yMean) ** 2;
      ssRes += (yi - yhat) ** 2;
    }
    r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  }

  const points: ForecastPoint[] = history.map((p, i) => ({
    day: p.day,
    actualUsd: p.usd,
    projectedUsd: intercept + slope * i,
  }));

  const startMs = history.length > 0 ? Date.parse(history[history.length - 1]!.day) : Date.now();
  for (let d = 1; d <= forwardDays; d++) {
    const day = new Date(startMs + d * 86_400_000).toISOString().slice(0, 10);
    points.push({
      day,
      actualUsd: null,
      projectedUsd: intercept + slope * (n - 1 + d),
    });
  }

  return { points, slopeUsdPerDay: slope, r2 };
}
