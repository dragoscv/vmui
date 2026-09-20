import "server-only";
import { CostRecosTable } from "@/components/costs/cost-recos-table";
import { EmptyState, PageHeader, PageSection, PageShell, Stat, StatGrid } from "@/components/ui";
import { generateCostRecommendations } from "@/lib/cost-recos";
import { formatUsd } from "@/lib/utils";
import { PiggyBank, Server } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function CostRecosPage() {
  const [t, recos] = await Promise.all([getTranslations("cloud.recos"), generateCostRecommendations(50)]);
  const total = recos.reduce((s, r) => s + r.monthlySavingsUsd, 0);

  return (
    <PageShell>
      <PageHeader icon={<PiggyBank />} title={t("title")} description={t("description")} />

      <StatGrid cols={2}>
        <Stat label={t("stats.total")} value={formatUsd(total)} hint={t("stats.totalHint", { count: recos.length })} tone="success" icon={<PiggyBank />} />
        <Stat label={t("stats.count")} value={recos.length} icon={<Server />} />
      </StatGrid>

      {recos.length === 0 ? (
        <EmptyState icon={<PiggyBank />} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <PageSection title={t("title")}>
          <CostRecosTable rows={recos} />
        </PageSection>
      )}
    </PageShell>
  );
}
