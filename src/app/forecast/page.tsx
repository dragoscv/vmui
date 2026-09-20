import { ForecastChart } from "@/components/cloud/forecast-chart";
import { PageHeader, PageShell, Stat, StatGrid } from "@/components/ui";
import { buildCostForecast } from "@/lib/cost-forecast";
import { formatUsd } from "@/lib/utils";
import { TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function ForecastPage() {
  const [t, { points, slopeUsdPerDay, r2 }] = await Promise.all([getTranslations("cloud.forecast"), buildCostForecast(30, 30)]);
  const day30Daily = points[points.length - 1]?.projectedUsd ?? 0;
  const monthlyAt30 = day30Daily * 30;

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<TrendingUp />} />
      <StatGrid cols={4}>
        <Stat
          label={t("stats.slope")}
          value={t("perDay", { amount: formatUsd(slopeUsdPerDay) })}
          hint={t("stats.slopeHint")}
          trend={{ delta: Math.round(slopeUsdPerDay * 100) / 100 }}
        />
        <Stat label={t("stats.r2")} value={r2.toFixed(3)} />
        <Stat label={t("stats.day30Daily")} value={formatUsd(day30Daily)} />
        <Stat label={t("stats.day30Monthly")} value={formatUsd(monthlyAt30)} />
      </StatGrid>
      <ForecastChart points={points} />
    </PageShell>
  );
}
