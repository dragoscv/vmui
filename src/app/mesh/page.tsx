import { listInstances } from "@/server/queries";
import { MeshWorkspace } from "@/components/mesh/mesh-workspace";

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

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Mesh networking</h1>
        <p className="text-sm text-muted">
          Generate a WireGuard full mesh config across selected VMs, or a Tailscale install + up command with tags, routes, and SSH.
        </p>
      </header>
      <MeshWorkspace instances={reachable} />
    </main>
  );
}
