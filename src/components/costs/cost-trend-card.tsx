import "server-only";
import { db } from "@/lib/db";
import { snapshotHistory } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart } from "lucide-react";
import { formatUsdPerHour } from "@/lib/utils";

interface Bucket {
  ts: number;
  hourlyUsd: number;
}

/**
 * Renders a 7-day hourly-burn sparkline from snapshot_history. Aggregates
 * cross-account values into one-hour buckets so the chart stays readable
 * even when multiple accounts capture history at different cadences.
 */
export async function CostTrendCard({ days = 7 }: { days?: number } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(snapshotHistory)
    .where(gte(snapshotHistory.capturedAt, since));

  if (rows.length < 2) {
    return (
      <Card className="surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LineChart className="h-4 w-4 text-[var(--color-primary)]" />
            {days}-day burn trend
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted">
          Need at least two history snapshots to draw the trend. Sync runs every 30s in the background.
        </CardContent>
      </Card>
    );
  }

  const bucketSize = 60 * 60 * 1000;
  const buckets = new Map<number, number>();
  for (const r of rows) {
    const ts = Math.floor(r.capturedAt.getTime() / bucketSize) * bucketSize;
    buckets.set(ts, (buckets.get(ts) ?? 0) + r.hourlyUsd);
  }
  const points: Bucket[] = [...buckets.entries()]
    .map(([ts, hourlyUsd]) => ({ ts, hourlyUsd }))
    .sort((a, b) => a.ts - b.ts);

  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.hourlyUsd);
  const minX = xs[0] ?? 0;
  const maxX = xs[xs.length - 1] ?? minX + 1;
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padY = (maxY - minY) * 0.1 || maxY * 0.1 || 1;

  const W = 800;
  const H = 120;
  const xScale = (t: number) => ((t - minX) / Math.max(1, maxX - minX)) * W;
  const yScale = (v: number) => H - ((v - (minY - padY)) / Math.max(0.0001, maxY + padY - (minY - padY))) * H;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.ts).toFixed(1)} ${yScale(p.hourlyUsd).toFixed(1)}`).join(" ");
  const area = `${path} L ${xScale(maxX).toFixed(1)} ${H} L ${xScale(minX).toFixed(1)} ${H} Z`;

  const last = points[points.length - 1]?.hourlyUsd ?? 0;
  const first = points[0]?.hourlyUsd ?? 0;
  const delta = last - first;
  const pct = first > 0 ? (delta / first) * 100 : 0;
  const trendColor = delta > 0.01 ? "var(--color-warning)" : delta < -0.01 ? "var(--color-success)" : "var(--color-muted)";

  return (
    <Card className="surface">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-[var(--color-primary)]" />
            {days}-day burn trend
          </span>
          <span className="text-xs font-normal" style={{ color: trendColor }}>
            {delta >= 0 ? "+" : ""}
            {formatUsdPerHour(delta)} ({pct >= 0 ? "+" : ""}
            {pct.toFixed(1)}%) vs {days}d ago
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="costtrend-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#costtrend-gradient)" />
          <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth={1.5} />
        </svg>
        <div className="mt-2 flex justify-between text-[11px] text-muted">
          <span>{new Date(minX).toLocaleDateString()}</span>
          <span>now · {formatUsdPerHour(last)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
