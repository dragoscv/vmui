"use client";

import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/ui/sparkline";
import { BarChart3, Cpu, MemoryStick } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useInstanceStats } from "./use-instance-stats";

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
  const t = useTranslations("vm.stats");
  const { latest, history } = useInstanceStats(accountId, { enabled, intervalMs: 2000, providerInstanceId, instanceId });

  if (!enabled) return null;
  if (!latest?.running) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-border" aria-hidden />
        <span>{t("idle")}</span>
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
      transition={{ duration: 0.2 }}
      className="flex items-center gap-3"
    >
      <Metric
        icon={Cpu}
        label={t("cpu")}
        value={`${cpu.toFixed(0)}%`}
        history={history.cpu}
        colorClass="text-primary"
        ariaLabel={t("trend", { metric: t("cpu") })}
      />
      <Metric
        icon={MemoryStick}
        label={t("memShort")}
        value={`${memPct.toFixed(0)}%`}
        history={history.mem}
        colorClass="text-accent"
        ariaLabel={t("trend", { metric: t("memory") })}
      />
      {onOpenDetails && (
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2 text-[11px]"
          onClick={onOpenDetails}
          aria-label={t("showDetails")}
        >
          <BarChart3 className="h-3 w-3" aria-hidden />
        </Button>
      )}
    </motion.div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  history,
  colorClass,
  ariaLabel,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: string;
  history: number[];
  colorClass: string;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex w-12 items-center gap-1 text-[10px] uppercase tracking-wider text-muted">
        <Icon className="h-3 w-3" aria-hidden />
        {label}
      </div>
      <Sparkline values={history} width={56} height={18} className={colorClass} ariaLabel={ariaLabel} />
      <div className={`w-9 text-right font-mono text-[11px] tabular-nums ${colorClass}`}>{value}</div>
    </div>
  );
}
