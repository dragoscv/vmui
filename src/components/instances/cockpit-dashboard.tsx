"use client";

import { useEffect, useRef, useState } from "react";
import { Cpu, MemoryStick, HardDrive, ArrowDownUp, Activity as ActivityIcon, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { probeInstanceAction } from "@/server/actions/probe";
import type { ProbeMetrics } from "@/lib/probe";

interface Props {
  instanceId: string;
  intervalSec?: number | null;
  initial?: ProbeMetrics | null;
}

function formatBytes(n: number, perSec = false): string {
  const suffix = perSec ? "/s" : "";
  if (n < 1024) return `${n.toFixed(0)} B${suffix}`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}${suffix}`;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Gauge({
  label,
  value,
  unit = "%",
  max = 100,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  unit?: string;
  max?: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "ok" | "warn" | "crit";
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const r = 38;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const colorVar =
    tone === "crit"
      ? "oklch(70% 0.22 25)"
      : tone === "warn"
      ? "oklch(80% 0.18 75)"
      : "var(--color-primary)";
  return (
    <div className="relative flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-surface-muted)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={colorVar}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dasharray 600ms cubic-bezier(.4,.2,.2,1)" }}
        />
        <text
          x="50"
          y="48"
          textAnchor="middle"
          fontSize="20"
          fontWeight="600"
          fill="var(--color-text)"
        >
          {value.toFixed(unit === "%" ? 0 : 1)}
        </text>
        <text x="50" y="64" textAnchor="middle" fontSize="11" fill="var(--color-text-muted)">
          {unit}
        </text>
      </svg>
      <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-muted">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
    </div>
  );
}

export function CockpitDashboard({ instanceId, intervalSec, initial }: Props) {
  const [metrics, setMetrics] = useState<ProbeMetrics | null>(initial ?? null);
  const [history, setHistory] = useState<{ t: number; cpu: number; mem: number; netIn: number; netOut: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const interval = intervalSec ?? 10;
  const lastRef = useRef<number>(0);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    let cancelled = false;
    const tick = async () => {
      if (!running) return;
      const out = await probeInstanceAction({ instanceId });
      if (cancelled) return;
      if (out.ok && out.metrics) {
        setMetrics(out.metrics);
        setError(null);
        setHistory((h) =>
          [
            ...h,
            {
              t: out.metrics!.collectedAt,
              cpu: out.metrics!.cpu,
              mem: out.metrics!.mem,
              netIn: out.metrics!.netIn,
              netOut: out.metrics!.netOut,
            },
          ].slice(-60),
        );
      } else {
        setError(out.error ?? "Probe failed");
      }
      lastRef.current = Date.now();
      timer = setTimeout(tick, interval * 1000);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [instanceId, interval, running]);

  const cpuTone: "ok" | "warn" | "crit" =
    !metrics ? "ok" : metrics.cpu >= 90 ? "crit" : metrics.cpu >= 70 ? "warn" : "ok";
  const memTone: "ok" | "warn" | "crit" =
    !metrics ? "ok" : metrics.mem >= 90 ? "crit" : metrics.mem >= 75 ? "warn" : "ok";
  const diskTone: "ok" | "warn" | "crit" =
    !metrics ? "ok" : metrics.disk >= 90 ? "crit" : metrics.disk >= 80 ? "warn" : "ok";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Cockpit</h2>
          <p className="text-xs text-muted">
            {metrics
              ? `${metrics.hostname} · sample every ${interval}s`
              : "Awaiting first sample…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRunning((r) => !r)}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
          >
            {running ? "Pause" : "Resume"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Gauge label="CPU" value={metrics?.cpu ?? 0} icon={Cpu} tone={cpuTone} />
        <Gauge label="Memory" value={metrics?.mem ?? 0} icon={MemoryStick} tone={memTone} />
        <Gauge label="Disk /" value={metrics?.disk ?? 0} icon={HardDrive} tone={diskTone} />
        <Gauge
          label="Load 1m"
          value={metrics?.load1 ?? 0}
          unit="load"
          max={Math.max(4, metrics?.cores.length ?? 4)}
          icon={ActivityIcon}
        />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-4 text-xs">
            <ArrowDownUp className="mb-1 h-4 w-4 text-[var(--color-primary)]" />
            <div className="font-mono text-sm">{formatBytes(metrics?.netIn ?? 0, true)}</div>
            <div className="font-mono text-[10px] text-muted">↓ in</div>
            <div className="mt-1 font-mono text-sm">{formatBytes(metrics?.netOut ?? 0, true)}</div>
            <div className="font-mono text-[10px] text-muted">↑ out</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-4 text-xs">
            <Clock className="mb-1 h-4 w-4 text-[var(--color-primary)]" />
            <div className="text-sm font-semibold">{metrics ? formatUptime(metrics.uptimeSec) : "—"}</div>
            <div className="text-[10px] text-muted">uptime</div>
            <div className="mt-1 text-[10px] text-muted">
              IOPS {metrics ? `${metrics.iopsRead}/${metrics.iopsWrite}` : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {metrics && metrics.cores.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <div className="mb-2 text-xs font-semibold text-muted">Per-core CPU ({metrics.cores.length})</div>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(metrics.cores.length, 16)}, minmax(0, 1fr))` }}>
              {metrics.cores.map((c, i) => (
                <div
                  key={i}
                  className="relative h-12 overflow-hidden rounded-sm bg-[var(--color-surface-muted)]"
                  title={`core ${i}: ${c.toFixed(1)}%`}
                >
                  <div
                    className="absolute inset-x-0 bottom-0 transition-[height] duration-500"
                    style={{
                      height: `${Math.min(100, c)}%`,
                      background: c >= 80 ? "oklch(70% 0.22 25)" : c >= 50 ? "oklch(80% 0.18 75)" : "var(--color-primary)",
                    }}
                  />
                  <div className="absolute inset-x-0 bottom-0 text-center text-[8px] font-mono leading-3 text-white mix-blend-difference">
                    {Math.round(c)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {history.length > 1 && (
        <Card>
          <CardContent className="py-3">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-muted">
              <span>Last {history.length} samples</span>
              <span className="font-mono text-[10px]">
                {formatBytes(metrics?.memUsedMb ? metrics.memUsedMb * 1024 * 1024 : 0)} /{" "}
                {formatBytes(metrics?.memTotalMb ? metrics.memTotalMb * 1024 * 1024 : 0)}
              </span>
            </div>
            <Sparkline data={history.map((h) => h.cpu)} color="var(--color-primary)" label="CPU%" />
            <Sparkline data={history.map((h) => h.mem)} color="oklch(75% 0.18 295)" label="Mem%" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Sparkline({ data, color, label }: { data: number[]; color: string; label: string }) {
  if (data.length < 2) return null;
  const w = 600;
  const h = 32;
  const max = Math.max(100, ...data);
  const stepX = w / (data.length - 1);
  const points = data.map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <div className="mb-2">
      <div className="mb-0.5 text-[10px] text-muted">{label}</div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
    </div>
  );
}
