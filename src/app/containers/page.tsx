import Link from "next/link";
import { listInstances } from "@/server/queries";
import { ContainerPanel } from "@/components/containers/container-panel";
import { Server, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ContainersPage() {
  const all = await listInstances();
  const reachable = all.filter(
    (i) =>
      i.state === "running" &&
      (i.platform === "linux" || i.platform === "macos") &&
      (i.publicIp || i.publicDns),
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Containers</h1>
        <p className="max-w-2xl text-sm text-muted">
          Containers running across all reachable Linux/macOS instances.
          Auto-detects docker / podman / nerdctl per host. Live-updates every 5s.
        </p>
      </header>

      {reachable.length === 0 && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-muted">
          No reachable Linux/macOS instances. Start one or add a probe key for an account.
        </div>
      )}

      <div className="grid gap-4">
        {reachable.map((inst) => (
          <details key={inst.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] open:shadow-sm" open>
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm">
              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
              <Server className="h-4 w-4 text-muted" />
              <Link
                href={`/instances/${encodeURIComponent(inst.id)}`}
                className="font-semibold hover:underline"
              >
                {inst.name ?? inst.providerInstanceId}
              </Link>
              <span className="text-[10px] uppercase text-muted">
                {inst.provider} · {inst.region}
              </span>
              <span className="ml-auto text-[10px] text-muted">{inst.publicIp ?? inst.publicDns}</span>
            </summary>
            <div className="border-t border-[var(--color-border)] p-3">
              <ContainerPanel instanceId={inst.id} />
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}
