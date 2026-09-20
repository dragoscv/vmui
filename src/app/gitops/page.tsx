import { GitopsWorkspace } from "@/components/gitops/gitops-workspace";
import { listInstances } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function GitopsPage() {
  const all = await listInstances();
  const reachable = all
    .filter(
      (i) =>
        i.state === "running" &&
        (i.platform === "linux" || i.platform === "macos") &&
        (i.publicIp || i.publicDns),
    )
    .map((i) => ({
      id: i.id,
      name: i.name,
      providerInstanceId: i.providerInstanceId,
      provider: i.provider,
    }));

  return <GitopsWorkspace instances={reachable} />;
}
