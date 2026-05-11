import { listInstances } from "@/server/queries";
import { K8sWorkspace } from "@/components/k8s/k8s-workspace";

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

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Kubernetes</h1>
        <p className="text-sm text-muted">
          One-click k3s / k0s install, web-based kubectl proxy, and Helm chart deploys — all over SSH, no exposed API server.
        </p>
      </header>
      <K8sWorkspace instances={reachable} />
    </main>
  );
}
