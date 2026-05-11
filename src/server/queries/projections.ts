import "server-only";
import { db } from "@/lib/db";
import { snapshotHistory } from "@/lib/db/schema";
import { gte } from "drizzle-orm";

export interface ProjectionBand {
  daysAhead: number;
  hourlyUsd: number;
  hourlyLo: number;
  hourlyHi: number;
  monthlyUsd: number;
  monthlyLo: number;
  monthlyHi: number;
}

export interface ProjectionResult {
  pointsUsed: number;
  rangeDays: number;
  slopeUsdPerDay: number;
  currentHourlyUsd: number;
  history: Array<{ t: number; hourlyUsd: number }>;
  bands: ProjectionBand[];
  /** Sigma of residuals in USD/hour; used to draw the confidence band. */
  sigma: number;
}

const HOURS_PER_MONTH = 730;
const HORIZONS = [30, 60, 90] as const;

export async function computeProjections(windowDays = 30): Promise<ProjectionResult | null> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(snapshotHistory)
    .where(gte(snapshotHistory.capturedAt, since));
  if (rows.length < 4) return null;

  const bucketed = new Map<number, number>();
  for (const r of rows) {
    const bucket = Math.floor(r.capturedAt.getTime() / (60 * 60 * 1000));
    bucketed.set(bucket, (bucketed.get(bucket) ?? 0) + r.hourlyUsd);
  }
  const sorted = [...bucketed.entries()].sort((a, b) => a[0] - b[0]);
  const xs = sorted.map(([b]) => b);
  const ys = sorted.map(([, v]) => v);
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

  // Residual standard deviation around the fit line.
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const pred = slopePerHour * (xs[i] ?? 0) + intercept;
    const r = (ys[i] ?? 0) - pred;
    sse += r * r;
  }
  const sigma = Math.sqrt(sse / Math.max(1, n - 2));

  const lastBucket = xs[n - 1] ?? 0;
  const currentHourlyUsd = Math.max(0, slopePerHour * lastBucket + intercept);

  const bands: ProjectionBand[] = HORIZONS.map((daysAhead) => {
    const futureBucket = lastBucket + daysAhead * 24;
    const point = slopePerHour * futureBucket + intercept;
    // Confidence widens with horizon — multiplier grows ~sqrt(daysAhead).
    const widen = sigma * Math.sqrt(daysAhead);
    const hourlyUsd = Math.max(0, point);
    const hourlyLo = Math.max(0, point - 1.96 * widen);
    const hourlyHi = Math.max(0, point + 1.96 * widen);
    return {
      daysAhead,
      hourlyUsd,
      hourlyLo,
      hourlyHi,
      monthlyUsd: hourlyUsd * HOURS_PER_MONTH,
      monthlyLo: hourlyLo * HOURS_PER_MONTH,
      monthlyHi: hourlyHi * HOURS_PER_MONTH,
    };
  });

  const history = sorted.map(([t, v]) => ({ t: t * 60 * 60 * 1000, hourlyUsd: v }));

  return {
    pointsUsed: n,
    rangeDays: windowDays,
    slopeUsdPerDay: slopePerHour * 24,
    currentHourlyUsd,
    history,
    bands,
    sigma,
  };
}
