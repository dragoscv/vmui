import { cn, formatUsd, formatUsdPerHour, HOURS_PER_MONTH } from "@/lib/utils";
import { DollarSign } from "lucide-react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("vm.cost");
  if (usdPerHour == null) {
    return (
      <span className={cn("text-[11px] text-muted", className)} title={t("noPrice")}>
        —
      </span>
    );
  }
  const sourceTitle = t("source", { source: source ?? "—" });
  if (usdPerHour === 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] px-2 py-0.5 text-[11px] font-medium text-success",
          className,
        )}
        title={sourceTitle}
      >
        {t("free")}
      </span>
    );
  }
  const monthly = usdPerHour * HOURS_PER_MONTH;
  const hourly = formatUsdPerHour(usdPerHour).replace(/\/hr$/, "");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-muted",
        className,
      )}
      title={sourceTitle}
    >
      <DollarSign className="h-3 w-3" aria-hidden />
      {t("perHour", { price: hourly })}
      {showMonthly && (
        <span className="opacity-60">· {t("perMonth", { price: formatUsd(monthly) })}</span>
      )}
    </span>
  );
}
