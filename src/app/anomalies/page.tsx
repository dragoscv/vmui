import { AnomaliesView } from "@/components/monitoring/anomalies-view";
import { Badge, PageHeader, PageShell, Stat, StatGrid } from "@/components/ui";
import { detectCostAnomalies } from "@/lib/cost-anomaly";
import { AlertTriangle, CalendarRange, DollarSign, Sigma } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function AnomaliesPage() {
  const t = await getTranslations("observe.anomalies");
  const format = await getFormatter();
  const { points, mean, stdDev, threshold, anomalies } = await detectCostAnomalies(30, 2.0);
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description", { threshold: format.number(threshold, { maximumFractionDigits: 1 }) })}
        icon={<AlertTriangle />}
        badge={
          anomalies.length > 0 ? (
            <Badge variant="warning">{t("anomalyCount", { count: anomalies.length })}</Badge>
          ) : (
            <Badge variant="success">{t("none")}</Badge>
          )
        }
      />
      <StatGrid cols={4}>
        <Stat label={t("stats.mean")} value={usd(mean)} icon={<DollarSign />} />
        <Stat label={t("stats.stdDev")} value={usd(stdDev)} icon={<Sigma />} />
        <Stat label={t("stats.window")} value={t("stats.days", { count: points.length })} icon={<CalendarRange />} />
        <Stat label={t("stats.anomalies")} value={anomalies.length} tone={anomalies.length > 0 ? "warning" : "success"} icon={<AlertTriangle />} />
      </StatGrid>
      <AnomaliesView points={points} mean={mean} stdDev={stdDev} threshold={threshold} />
    </PageShell>
  );
}
