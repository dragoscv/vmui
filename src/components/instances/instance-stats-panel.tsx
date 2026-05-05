"use client";

import { motion } from "motion/react";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  ArrowDown,
  ArrowUp,
  Clock,
  WifiOff,
} from "lucide-react";
import { Sparkline } from "./sparkline";
import {
  useInstanceStats,
  formatBps,
  formatBytes,
  formatUptime,
} from "./use-instance-stats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  accountId: string;
  enabled?: boolean;
  intervalMs?: number;
  className?: string;
}

/**
 * Detailed live stats panel — CPU, memory, disk I/O, network — with sparklines
 * over the last ~60 samples. Updates every 2 s by default.
 */
export function InstanceStatsPanel({
  accountId,
  enabled = true,
  intervalMs = 2000,
  className,
}: Props) {
  const { latest, history, error } = useInstanceStats(accountId, { enabled, intervalMs });

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Live performance</CardTitle>
          <LiveBadge running={latest?.running ?? false} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] p-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        {latest?.note && (
          <div className="text-xs text-muted">{latest.note}</div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Tile
            icon={Cpu}
            label="CPU"
            primary={
              latest?.cpuPercent !== undefined
                ? `${latest.cpuPercent.toFixed(1)}%`
                : "—"
            }
            secondary="across all vCPUs"
            history={history.cpu}
            color="var(--color-primary)"
            max={100}
            unit="%"
          />
          <Tile
            icon={MemoryStick}
            label="Memory"
            primary={
              latest?.memUsedBytes && latest.memTotalBytes
                ? `${Math.min(100, (latest.memUsedBytes / latest.memTotalBytes) * 100).toFixed(0)}%`
                : "—"
            }
            secondary={
              latest?.memUsedBytes
                ? `${formatBytes(latest.memUsedBytes)} / ${formatBytes(latest.memTotalBytes)}`
                : "host RSS / configured"
            }
            history={history.mem}
            color="var(--color-accent)"
            max={100}
            unit="%"
          />
          <DualTile
            icon={HardDrive}
            label="Disk I/O"
            seriesA={{ name: "read", values: history.diskR, color: "var(--color-info, #38bdf8)" }}
            seriesB={{ name: "write", values: history.diskW, color: "var(--color-warning, #f59e0b)" }}
            primaryA={formatBps(latest?.diskReadBps)}
            primaryB={formatBps(latest?.diskWriteBps)}
            iconA={ArrowDown}
            iconB={ArrowUp}
          />
          <DualTile
            icon={Network}
            label="Network"
            seriesA={{ name: "rx", values: history.netRx, color: "var(--color-success, #22c55e)" }}
            seriesB={{ name: "tx", values: history.netTx, color: "var(--color-primary)" }}
            primaryA={formatBps(latest?.netRxBps)}
            primaryB={formatBps(latest?.netTxBps)}
            iconA={ArrowDown}
            iconB={ArrowUp}
          />
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-3 text-xs text-muted">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Uptime: <span className="font-mono">{formatUptime(latest?.uptimeSeconds)}</span>
          </div>
          <div>
            sampled {latest?.sampledAt ? new Date(latest.sampledAt).toLocaleTimeString() : "—"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LiveBadge({ running }: { running: boolean }) {
  return (
    <Badge variant={running ? "success" : "muted"} className="gap-1.5">
      {running ? (
        <>
          <motion.span
            className="inline-block h-1.5 w-1.5 rounded-full bg-current"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
          live
        </>
      ) : (
        <>
          <WifiOff className="h-3 w-3" />
          offline
        </>
      )}
    </Badge>
  );
}

function Tile({
  icon: Icon,
  label,
  primary,
  secondary,
  history,
  color,
  max,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  secondary: string;
  history: number[];
  color: string;
  max?: number;
  unit?: string;
}) {
  return (
    <motion.div
      layout
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted">
          <Icon className="h-3 w-3" />
          {label}
        </div>
        <div className="font-mono text-base tabular-nums" style={{ color }}>
          {primary}
        </div>
      </div>
      <div className="mt-1 text-[11px] text-muted">{secondary}</div>
      <div className="mt-2">
        <Sparkline values={history} width={260} height={42} color={color} max={max} />
      </div>
    </motion.div>
  );
}

function DualTile({
  icon: Icon,
  label,
  seriesA,
  seriesB,
  primaryA,
  primaryB,
  iconA: IconA,
  iconB: IconB,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  seriesA: { name: string; values: number[]; color: string };
  seriesB: { name: string; values: number[]; color: string };
  primaryA: string;
  primaryB: string;
  iconA: React.ComponentType<{ className?: string }>;
  iconB: React.ComponentType<{ className?: string }>;
}) {
  // Shared scale so the two lines are comparable
  const max = Math.max(1, ...seriesA.values, ...seriesB.values);
  return (
    <motion.div
      layout
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted">
          <Icon className="h-3 w-3" />
          {label}
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
          <span className="flex items-center gap-1" style={{ color: seriesA.color }}>
            <IconA className="h-3 w-3" />
            {primaryA}
          </span>
          <span className="flex items-center gap-1" style={{ color: seriesB.color }}>
            <IconB className="h-3 w-3" />
            {primaryB}
          </span>
        </div>
      </div>
      <div className="relative mt-2 h-[42px]">
        <div className="absolute inset-0">
          <Sparkline
            values={seriesA.values}
            width={260}
            height={42}
            color={seriesA.color}
            max={max}
            fill={false}
            showDot={false}
          />
        </div>
        <div className="absolute inset-0">
          <Sparkline
            values={seriesB.values}
            width={260}
            height={42}
            color={seriesB.color}
            max={max}
            fill={false}
          />
        </div>
      </div>
    </motion.div>
  );
}
