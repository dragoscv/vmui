import "server-only";
import { getProviderStatuses } from "@/lib/provider-status";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function ProviderStatusPage() {
  const statuses = await getProviderStatuses();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Provider status board</h1>
        <p className="text-sm text-zinc-400">
          Reachability of each provider&rsquo;s public status page. Refreshed every minute.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {statuses.map((s) => {
          const dot = s.state === "ok" ? "bg-emerald-400" : s.state === "incident" ? "bg-rose-400" : "bg-zinc-500";
          return (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm hover:border-zinc-700 transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
                <div className="min-w-0">
                  <div className="font-medium truncate">{s.label}</div>
                  <div className="text-xs text-zinc-500 capitalize">{s.state}{s.latencyMs !== null ? ` · ${s.latencyMs} ms` : ""}</div>
                </div>
              </div>
              <span className="text-xs text-zinc-600">↗</span>
            </a>
          );
        })}
      </div>
      <p className="text-xs text-zinc-600">Note: HEAD success ≠ no incidents — check the linked page for full detail.</p>
    </div>
  );
}
