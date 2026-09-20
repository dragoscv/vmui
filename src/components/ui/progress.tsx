import { cn } from "@/lib/utils";
import * as React from "react";

export type ProgressTone = "default" | "success" | "warning" | "danger" | "info";

const BAR_TONE: Record<ProgressTone, string> = {
  default: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Progress({
  value,
  max = 100,
  label,
  tone = "default",
  size = "md",
  indeterminate = false,
  className,
}: {
  value?: number;
  max?: number;
  label?: React.ReactNode;
  tone?: ProgressTone;
  size?: "sm" | "md";
  indeterminate?: boolean;
  className?: string;
}) {
  const clamped = Math.min(max, Math.max(0, value ?? 0));
  const pct = max > 0 ? (clamped / max) * 100 : 0;
  const labelId = React.useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <div id={labelId} className="flex items-center justify-between gap-2 text-xs text-muted">
          <span>{label}</span>
          {!indeterminate && <span className="tabular-nums">{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-labelledby={label ? labelId : undefined}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={indeterminate ? undefined : clamped}
        className={cn("relative w-full overflow-hidden rounded-full bg-bg-muted", size === "sm" ? "h-1.5" : "h-2.5")}
      >
        {indeterminate ? (
          <div className="skeleton h-full w-full rounded-full" />
        ) : (
          <div
            className={cn("h-full rounded-full transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out)]", BAR_TONE[tone])}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}
