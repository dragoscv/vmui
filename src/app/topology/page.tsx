import { loadTopology } from "@/server/queries/topology";
import { TopologyGraph } from "@/components/topology/topology-graph";

export const dynamic = "force-dynamic";

export default async function TopologyPage() {
  const data = await loadTopology();

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Topology</h1>
          <p className="text-sm text-muted">
            Force-directed graph of accounts, instances and resources. Drag to rotate · scroll to zoom · click a node to focus.
          </p>
        </div>
        <div className="text-xs text-muted">
          {data.nodes.length} nodes · {data.edges.length} edges
        </div>
      </div>
      <div className="h-[calc(100vh-220px)] min-h-[480px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <TopologyGraph data={data} />
      </div>
    </div>
  );
}
