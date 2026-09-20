import { RecommendationCards, type RecommendationCardData } from "@/components/costs/recommendation-cards";
import { RecomputeButton } from "@/components/costs/recompute-button";
import { EmptyState, PageHeader, PageShell, Stat, StatGrid } from "@/components/ui";
import { formatUsd } from "@/lib/utils";
import { listCostRecommendations, totalProjectedMonthlySavings } from "@/server/queries/cost-recommendations";
import { PiggyBank, Power, Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import "server-only";

export const dynamic = "force-dynamic";

export default async function CostRecommendationsPage() {
  const [t, rows, total] = await Promise.all([getTranslations("cloud.recommendations"), listCostRecommendations(), totalProjectedMonthlySavings()]);

  const cards: RecommendationCardData[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    confidence: r.confidence,
    instanceId: r.instanceId,
    instanceName: r.instanceName,
    instanceType: r.instanceType,
    provider: r.provider,
    region: r.region,
    summary: r.summary,
    suggestedInstanceType: r.suggestedInstanceType,
    observedCpuP95: r.observedCpuP95,
    lookbackHours: r.lookbackHours,
    estMonthlySavingsUsd: r.estMonthlySavingsUsd,
  }));
  const idleCount = rows.filter((r) => r.kind === "idle").length;

  return (
    <PageShell>
      <PageHeader icon={<Sparkles />} title={t("title")} description={t("description")} actions={<RecomputeButton />} />

      <StatGrid cols={3}>
        <Stat label={t("stats.open")} value={rows.length} icon={<Sparkles />} />
        <Stat label={t("stats.savings")} value={formatUsd(total)} tone="success" icon={<PiggyBank />} />
        <Stat label={t("stats.idle")} value={idleCount} tone={idleCount > 0 ? "warning" : "default"} icon={<Power />} />
      </StatGrid>

      {cards.length === 0 ? (
        <EmptyState icon={<Sparkles />} title={t("empty.title")} description={t("empty.description")} action={<RecomputeButton />} />
      ) : (
        <RecommendationCards rows={cards} />
      )}
    </PageShell>
  );
}
