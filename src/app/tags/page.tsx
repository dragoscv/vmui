import { listInstances } from "@/server/queries";
import { getTagGovernance } from "@/server/queries/tag-governance";
import { BulkTagPanel } from "@/components/tags/bulk-tag-panel";
import { TagGovernancePanel } from "@/components/tags/tag-governance-panel";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const [instances, governance] = await Promise.all([listInstances(), getTagGovernance()]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tags</h1>
        <p className="text-sm text-muted">Govern, audit, and bulk-apply tags across your fleet.</p>
      </div>
      <TagGovernancePanel data={governance} />
      <BulkTagPanel
        rows={instances.map((i) => ({
          id: i.id,
          name: i.name,
          displayName: i.displayName,
          provider: i.provider,
          region: i.region,
          state: i.state,
          instanceType: i.instanceType,
        }))}
      />
    </div>
  );
}
