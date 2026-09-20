import { TopologyGraph } from "@/components/topology/topology-graph";
import { loadTopology } from "@/server/queries/topology";

export const dynamic = "force-dynamic";

export default async function TopologyPage() {
  const data = await loadTopology();
  return <TopologyGraph data={data} />;
}
