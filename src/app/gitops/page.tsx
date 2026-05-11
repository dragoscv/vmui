import { listInstances } from "@/server/queries";
import { GitopsWorkspace } from "@/components/gitops/gitops-workspace";

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

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">GitOps</h1>
        <p className="text-sm text-muted">
          Watch a Git repository and auto-apply every compose change to a target VM. Supports public, HTTPS-token, and SSH-key sources.
        </p>
      </header>
      <GitopsWorkspace instances={reachable} />
    </main>
  );
}
