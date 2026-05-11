import { listInstances } from "@/server/queries";
import { BuildsWorkspace } from "@/components/builds/builds-workspace";

export const dynamic = "force-dynamic";

export default async function BuildsPage() {
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
      region: i.region,
    }));

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Builds & Registries</h1>
        <p className="text-sm text-muted">
          Configure container registries, then build & push Docker images locally on the vmui host or remotely on any reachable VM.
        </p>
      </header>
      <BuildsWorkspace instances={reachable} />
    </main>
  );
}
