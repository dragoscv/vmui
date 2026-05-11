import { DollarSign } from "lucide-react";
import { formatUsdPerHour, formatUsd, HOURS_PER_MONTH, cn } from "@/lib/utils";

/**
 * Compact cost pill: "$0.0832/hr · ~$60/mo".
 * Renders as muted text when price is unknown. Free instances ("local-kvm")
 * get a soft success-tinted "free" badge.
 */
export function CostPill({
  usdPerHour,
  source,
  className,
  showMonthly = true,
}: {
  usdPerHour: number | null;
  source: string | null;
  className?: string;
  showMonthly?: boolean;
}) {
  if (usdPerHour == null) {
    return (
      <span className={cn("text-[11px] text-muted", className)} title="No price data">
        —
      </span>
    );
  }
  if (usdPerHour === 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-success)]",
          className,
        )}
        title={`Source: ${source ?? "—"}`}
      >
        free
      </span>
    );
  }
  const monthly = usdPerHour * HOURS_PER_MONTH;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-muted",
        className,
      )}
      title={`Source: ${source ?? "—"}`}
    >
      <DollarSign className="h-3 w-3" />
      {formatUsdPerHour(usdPerHour)}
      {showMonthly && (
        <span className="opacity-60">· {formatUsd(monthly)}/mo</span>
      )}
    </span>
  );
}
