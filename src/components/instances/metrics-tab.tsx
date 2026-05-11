"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { motion } from "motion/react";
import { Activity, Loader2, RefreshCw } from "lucide-react";
import { getMetricsHistoryAction } from "@/server/actions/metrics";
import type { MetricsHistory, MetricSeries } from "@/lib/providers/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  accountId: string;
  providerInstanceId: string;
  /** When false, the panel just shows a hint and never fetches. */
  enabled?: boolean;
}

const RANGES = [
  { id: "30m", label: "30m", minutes: 30 },
  { id: "1h", label: "1h", minutes: 60 },
  { id: "6h", label: "6h", minutes: 360 },
  { id: "24h", label: "24h", minutes: 1440 },
  { id: "7d", label: "7d", minutes: 60 * 24 * 7 },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

export function MetricsTab({ accountId, providerInstanceId, enabled = true }: Props) {
  const [range, setRange] = useState<RangeId>("1h");
  const [data, setData] = useState<MetricsHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const minutes = RANGES.find((r) => r.id === range)?.minutes ?? 60;

  const reload = () => {
    setError(null);
    start(async () => {
      const r = await getMetricsHistoryAction(accountId, providerInstanceId, minutes);
      if (r.ok) setData(r.data);
      else setError(r.error);
    });
  };

  useEffect(() => {
    if (!enabled) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, providerInstanceId, range, enabled]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-[var(--color-primary)]" />
            Metrics
            {data?.source && <Badge variant="muted" className="text-[10px]">{data.source}</Badge>}
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-[var(--color-border)] p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className={
                    "rounded px-2 py-0.5 text-xs transition-colors " +
                    (range === r.id
                      ? "bg-[var(--color-primary)] text-white"
                      : "text-muted hover:bg-[var(--color-bg-muted)]")
                  }
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={reload} disabled={pending}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] p-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}
        {data?.note && (
          <div className="rounded-md bg-[var(--color-bg-muted)] px-3 py-1.5 text-[11px] text-muted">
            {data.note}
          </div>
        )}
        {!data && !error && (
          <div className="grid place-items-center py-12 text-xs text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {data && (
          <div className="grid gap-4 sm:grid-cols-2">
            {data.series.map((s) => (
              <SeriesChart key={s.id} series={s} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SeriesChart({ series }: { series: MetricSeries }) {
  const points = series.points.filter((p) => p.v != null) as { t: number; v: number }[];
  const last = points[points.length - 1]?.v ?? null;
  const max = useMemo(() => {
    if (points.length === 0) return 1;
    const m = Math.max(...points.map((p) => p.v));
    return m > 0 ? m * 1.1 : 1;
  }, [points]);

  const w = 360;
  const h = 64;
  const path = useMemo(() => {
    if (points.length < 2) return "";
    const t0 = points[0]!.t;
    const tN = points[points.length - 1]!.t;
    const span = Math.max(1, tN - t0);
    return points
      .map((p, i) => {
        const x = ((p.t - t0) / span) * w;
        const y = h - (p.v / max) * (h - 4) - 2;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points, max]);

  const formatted = format(last, series.unit);
  const peakFormatted = format(max / 1.1, series.unit);

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-bg)_60%,transparent)] p-3">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium">{series.label}</span>
        <span className="font-mono tabular-nums text-muted">
          {formatted} <span className="opacity-60">peak {peakFormatted}</span>
        </span>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${series.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {points.length > 1 ? (
          <>
            <motion.path
              key={path}
              d={`${path} L${w},${h} L0,${h} Z`}
              fill={`url(#grad-${series.id})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
            />
            <motion.path
              key={`stroke-${path}`}
              d={path}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={1.5}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            />
          </>
        ) : (
          <text x={w / 2} y={h / 2} textAnchor="middle" className="fill-current" fontSize="10" opacity="0.5">
            no data
          </text>
        )}
      </svg>
    </div>
  );
}

function format(v: number | null, unit: MetricSeries["unit"]): string {
  if (v == null) return "—";
  if (unit === "percent") return `${v.toFixed(1)}%`;
  if (unit === "bps") return formatBps(v);
  return formatBytes(v);
}

function formatBps(v: number): string {
  if (v < 1024) return `${v.toFixed(0)} B/s`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB/s`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB/s`;
  return `${(v / 1024 ** 3).toFixed(2)} GB/s`;
}

function formatBytes(v: number): string {
  if (v < 1024) return `${v.toFixed(0)} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
}
