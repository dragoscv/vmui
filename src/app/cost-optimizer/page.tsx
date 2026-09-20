import { CostOptimizerView } from "@/components/cost-optimizer/cost-optimizer-view";
import { PageHeader, PageShell } from "@/components/ui";
import { generateCostRecommendations } from "@/lib/cost-optimizer";
import { Gauge } from "lucide-react";
import { getTranslations } from "next-intl/server";
import "server-only";

export const dynamic = "force-dynamic";

export default async function CostOptimizerPage() {
  const [t, recs] = await Promise.all([getTranslations("cloud.optimizer"), generateCostRecommendations()]);
  return (
    <PageShell>
      <PageHeader icon={<Gauge />} title={t("title")} description={t("description")} />
      <CostOptimizerView recommendations={recs} />
    </PageShell>
  );
}
