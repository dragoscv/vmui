import "server-only";
import { ProviderTile } from "@/components/cloud/provider-tile";
import { Badge, PageSection } from "@/components/ui";
import { formatUsdPerHour } from "@/lib/utils";
import { detectCostAnomalies } from "@/server/queries/cost-anomalies";
import { getTranslations } from "next-intl/server";

export async function CostAnomaliesCard() {
  const rows = await detectCostAnomalies();
  if (rows.length === 0) return null;
  const t = await getTranslations("cloud.costs.anomalies");
  return (
    <PageSection title={t("title")} description={t("description")}>
      <ul className="space-y-2">
        {rows.map((a) => (
          <li
            key={`${a.accountId}:${a.day}`}
            className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-bg-muted/40 px-3 py-2 text-xs"
          >
            <ProviderTile provider={a.provider} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{a.accountName}</div>
              <div className="font-mono text-[11px] text-muted">{a.day}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono tabular-nums">{formatUsdPerHour(a.hourlyUsd)}</div>
              <div className="text-[11px] text-muted">{t("vsAverage", { amount: formatUsdPerHour(a.trailingAvgUsd) })}</div>
            </div>
            <Badge variant={a.severity === "alert" ? "danger" : a.severity === "warn" ? "warning" : "info"}>
              {t("ratio", { ratio: a.ratio.toFixed(1) })}
            </Badge>
          </li>
        ))}
      </ul>
    </PageSection>
  );
}
