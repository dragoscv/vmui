import { MeshWorkspace } from "@/components/mesh/mesh-workspace";
import { listInstances } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function MeshPage() {
  const all = await listInstances();
  const reachable = all
    .filter((i) => i.state === "running" && (i.publicIp || i.privateIp))
    .map((i) => ({
      id: i.id,
      name: i.name,
      providerInstanceId: i.providerInstanceId,
      provider: i.provider,
      publicIp: i.publicIp,
      privateIp: i.privateIp,
    }));

  return <MeshWorkspace instances={reachable} />;
}
