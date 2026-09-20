import { cn } from "@/lib/utils";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import * as React from "react";
import { SkeletonStat } from "./skeleton";

export type StatTone = "default" | "success" | "warning" | "danger" | "info";

const VALUE_TONE: Record<StatTone, string> = {
  default: "text-fg",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = "default",
  trend,
  loading = false,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: StatTone;
  trend?: { delta: number; label?: React.ReactNode };
  loading?: boolean;
  className?: string;
}) {
  if (loading) return <SkeletonStat className={className} />;
  const TrendIcon = trend ? (trend.delta > 0 ? TrendingUp : trend.delta < 0 ? TrendingDown : Minus) : null;
  const trendTone = trend ? (trend.delta > 0 ? "text-success" : trend.delta < 0 ? "text-danger" : "text-muted") : "";
  return (
    <div className={cn("surface flex flex-col gap-2 p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
        {icon && (
          <span className="shrink-0 text-muted [&>svg]:size-4" aria-hidden>
            {icon}
          </span>
        )}
      </div>
      <div className={cn("font-display text-2xl font-semibold leading-none tabular-nums", VALUE_TONE[tone])}>{value}</div>
      {(trend || hint) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {trend && TrendIcon && (
            <span className={cn("inline-flex items-center gap-1 font-medium tabular-nums", trendTone)}>
              <TrendIcon className="size-3.5" aria-hidden />
              {trend.delta > 0 ? "+" : ""}
              {trend.delta}
              {trend.label && <span className="font-normal text-muted">{trend.label}</span>}
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}

const COLS: Record<2 | 3 | 4 | 5, string> = {
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
};

export function StatGrid({ children, cols = 4, className }: { children: React.ReactNode; cols?: 2 | 3 | 4 | 5; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", COLS[cols], className)}>{children}</div>;
}
