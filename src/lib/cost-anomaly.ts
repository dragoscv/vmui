import "server-only";
import { db } from "@/lib/db";
import { snapshotHistory } from "@/lib/db/schema";
import { gte, asc } from "drizzle-orm";

export interface AnomalyPoint {
  day: string;
  usd: number;
  zScore: number;
  isAnomaly: boolean;
}

export interface AnomalyReport {
  points: AnomalyPoint[];
  mean: number;
  stdDev: number;
  threshold: number;
  anomalies: AnomalyPoint[];
}

/**
 * Detect anomalies in daily fleet spend using z-score over a sliding window.
 * Defaults: 30-day history, threshold |z| >= 2.0 flagged.
 */
export async function detectCostAnomalies(historyDays = 30, threshold = 2.0): Promise<AnomalyReport> {
  const since = new Date(Date.now() - historyDays * 86_400_000);
  const rows = db
    .select()
    .from(snapshotHistory)
    .where(gte(snapshotHistory.capturedAt, since))
    .orderBy(asc(snapshotHistory.capturedAt))
    .all();

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

  if (history.length < 3) {
    return { points: [], mean: 0, stdDev: 0, threshold, anomalies: [] };
  }

  const mean = history.reduce((s, p) => s + p.usd, 0) / history.length;
  const variance = history.reduce((s, p) => s + (p.usd - mean) ** 2, 0) / history.length;
  const stdDev = Math.sqrt(variance);

  const points: AnomalyPoint[] = history.map((p) => {
    const z = stdDev > 0 ? (p.usd - mean) / stdDev : 0;
    return { day: p.day, usd: p.usd, zScore: z, isAnomaly: Math.abs(z) >= threshold };
  });

  return {
    points,
    mean,
    stdDev,
    threshold,
    anomalies: points.filter((p) => p.isAnomaly),
  };
}
