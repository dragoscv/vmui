"use client";

import { motion } from "motion/react";
import { Cpu, MemoryStick, BarChart3 } from "lucide-react";
import { Sparkline } from "./sparkline";
import { useInstanceStats } from "./use-instance-stats";
import { Button } from "@/components/ui/button";

/**
 * Compact, one-line stats strip for the InstanceCard. Polls only when the
 * VM is in a state where stats are meaningful.
 */
export function InstanceStatsInline({
  accountId,
  enabled,
  onOpenDetails,
  providerInstanceId,
  instanceId,
}: {
  accountId: string;
  enabled: boolean;
  onOpenDetails?: () => void;
  providerInstanceId?: string;
  instanceId?: string;
}) {
  const { latest, history } = useInstanceStats(accountId, { enabled, intervalMs: 2000, providerInstanceId, instanceId });

  if (!enabled) return null;
  if (!latest?.running) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-border)]" />
        <span>idle — no metrics</span>
      </div>
    );
  }

  const cpu = Math.min(100, Math.max(0, latest.cpuPercent ?? 0));
  const memPct = Math.min(
    100,
    latest.memUsedBytes && latest.memTotalBytes
      ? (latest.memUsedBytes / latest.memTotalBytes) * 100
      : 0,
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-3"
    >
      <Stat
        icon={Cpu}
        label="CPU"
        value={`${cpu.toFixed(0)}%`}
        history={history.cpu}
        color="var(--color-primary)"
        max={100}
      />
      <Stat
        icon={MemoryStick}
        label="MEM"
        value={`${memPct.toFixed(0)}%`}
        history={history.mem}
        color="var(--color-accent)"
        max={100}
      />
      {onOpenDetails && (
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2 text-[11px]"
          onClick={onOpenDetails}
          aria-label="Show detailed stats"
        >
          <BarChart3 className="h-3 w-3" />
        </Button>
      )}
    </motion.div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  history,
  color,
  max,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  history: number[];
  color: string;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex w-12 items-center gap-1 text-[10px] uppercase tracking-wider text-muted">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <Sparkline values={history} width={56} height={18} color={color} max={max} />
      <div
        className="w-9 text-right font-mono text-[11px] tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}
