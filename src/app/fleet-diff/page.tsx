import "server-only";
import { getLatestFleetDiff, captureFleetSnapshot } from "@/lib/fleet-diff";
import { requireRole } from "@/lib/auth";

async function captureAction() {
  "use server";
  await requireRole("operator");
  await captureFleetSnapshot();
}

export const dynamic = "force-dynamic";

export default async function FleetDiffPage() {
  const diff = await getLatestFleetDiff();

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fleet diff</h1>
          <p className="text-sm text-zinc-400">
            Compare today&rsquo;s fleet to the previous snapshot.
          </p>
        </div>
        <form action={captureAction}>
          <button type="submit" className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800">
            Capture snapshot now
          </button>
        </form>
      </header>

      {!diff && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">
          No snapshots yet. Capture one to begin tracking changes day-over-day.
        </div>
      )}

      {diff && (
        <div className="space-y-4 text-sm">
          <div className="text-zinc-400">
            Comparing {diff.beforeAt ? diff.beforeAt.toLocaleString() : "(nothing)"}
            {" → "}
            {diff.afterAt.toLocaleString()}
          </div>

          <Section title="Added" items={diff.added} tone="emerald" empty="No new VMs." />
          <Section title="Removed" items={diff.removed} tone="rose" empty="No removed VMs." />

          <div className="rounded-lg border border-zinc-800 bg-zinc-950">
            <div className="border-b border-zinc-800 px-4 py-2 font-medium text-amber-300">
              Changed ({diff.changed.length})
            </div>
            {diff.changed.length === 0 ? (
              <div className="px-4 py-3 text-zinc-500">No changes.</div>
            ) : (
              <table className="w-full text-left">
                <thead className="text-xs uppercase text-zinc-500">
                  <tr><th className="px-4 py-2">VM</th><th className="px-4 py-2">Field</th><th className="px-4 py-2">Before</th><th className="px-4 py-2">After</th></tr>
                </thead>
                <tbody>
                  {diff.changed.map((c) => c.fields.map((f) => (
                    <tr key={`${c.after.providerInstanceId}:${f}`} className="border-t border-zinc-900">
                      <td className="px-4 py-2 font-mono text-xs">{c.after.name ?? c.after.providerInstanceId}</td>
                      <td className="px-4 py-2">{f}</td>
                      <td className="px-4 py-2 font-mono text-xs text-rose-300">{String((c.before as unknown as Record<string, unknown>)[f] ?? "—")}</td>
                      <td className="px-4 py-2 font-mono text-xs text-emerald-300">{String((c.after as unknown as Record<string, unknown>)[f] ?? "—")}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, items, tone, empty }: { title: string; items: { name: string | null; providerInstanceId: string; region: string }[]; tone: "emerald" | "rose"; empty: string }) {
  const color = tone === "emerald" ? "text-emerald-300" : "text-rose-300";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950">
      <div className={`border-b border-zinc-800 px-4 py-2 font-medium ${color}`}>{title} ({items.length})</div>
      {items.length === 0 ? (
        <div className="px-4 py-3 text-zinc-500">{empty}</div>
      ) : (
        <ul className="divide-y divide-zinc-900">
          {items.map((m) => (
            <li key={m.providerInstanceId} className="flex items-center justify-between px-4 py-2 font-mono text-xs">
              <span>{m.name ?? m.providerInstanceId}</span>
              <span className="text-zinc-500">{m.region}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
