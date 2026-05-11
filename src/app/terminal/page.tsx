import { listInstances } from "@/server/queries";
import { TerminalPicker } from "@/components/terminal/terminal-picker";

export const dynamic = "force-dynamic";

export default async function TerminalPage() {
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
      publicIp: i.publicIp,
    }));

  return (
    <main className="mx-auto flex h-screen w-full max-w-7xl flex-col gap-3 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Terminal</h1>
        <p className="text-sm text-muted">
          Open a shell on any reachable VM or inside any running container — all over the same SSH WS bridge.
        </p>
      </header>
      <div className="flex-1 min-h-0">
        <TerminalPicker instances={reachable} />
      </div>
    </main>
  );
}
