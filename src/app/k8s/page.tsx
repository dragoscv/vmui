import { K8sWorkspace } from "@/components/k8s/k8s-workspace";
import { listInstances } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function K8sPage() {
  const all = await listInstances();
  const reachable = all
    .filter((i) => i.state === "running" && (i.publicIp || i.publicDns) && i.platform !== "windows")
    .map((i) => ({
      id: i.id,
      name: i.name,
      providerInstanceId: i.providerInstanceId,
      provider: i.provider,
    }));

  return <K8sWorkspace instances={reachable} />;
}
