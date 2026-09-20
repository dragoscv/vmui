import { PageSection } from "@/components/ui";
import { cn, formatUsd, HOURS_PER_MONTH } from "@/lib/utils";
import { computeCostForecast } from "@/server/queries/forecast";
import { getTranslations } from "next-intl/server";
import "server-only";

export async function CostForecastCard() {
  const [t, tc, f] = await Promise.all([
    getTranslations("cloud.costs.forecast"),
    getTranslations("cloud.costs"),
    computeCostForecast(),
  ]);

  if (!f) {
    return (
      <PageSection title={t("title")}>
        <p className="text-xs text-muted">{t("notEnough")}</p>
      </PageSection>
    );
  }

  const up = f.slopeUsdPerDay > 0.01;
  const down = f.slopeUsdPerDay < -0.01;
  const slopeTone = up ? "text-warning" : down ? "text-success" : "text-fg";

  return (
    <PageSection title={t("title")} description={t("description", { days: f.rangeDays, count: f.pointsUsed })}>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted">{t("hourly")}</dt>
          <dd className="mt-1 text-2xl font-semibold leading-none tabular-nums">{tc("perHour", { amount: formatUsd(f.forecastHourlyUsd) })}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">{t("monthly")}</dt>
          <dd className="mt-1 text-2xl font-semibold leading-none tabular-nums">{formatUsd(f.forecastHourlyUsd * HOURS_PER_MONTH)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">{t("slope")}</dt>
          <dd className={cn("mt-1 text-2xl font-semibold leading-none tabular-nums", slopeTone)}>
            {tc("perDay", { amount: `${f.slopeUsdPerDay >= 0 ? "+" : ""}${formatUsd(f.slopeUsdPerDay)}` })}
          </dd>
        </div>
      </dl>
    </PageSection>
  );
}
