import { generateCostRecommendations } from "@/lib/cost-optimizer";
import { CostOptimizerView } from "@/components/cost-optimizer/cost-optimizer-view";

export const dynamic = "force-dynamic";

export default async function CostOptimizerPage() {
  const recs = await generateCostRecommendations();
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Cost optimizer</h1>
        <p className="text-sm text-muted">
          Idle detection, rightsizing recommendations, and reserved-instance savings estimates based on 7-day metric history and the pricing cache.
        </p>
      </header>
      <CostOptimizerView recommendations={recs} />
    </main>
  );
}
