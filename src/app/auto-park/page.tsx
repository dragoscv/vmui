import { db } from "@/lib/db";
import { idleParkPolicies, instances } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { setIdleParkPolicyAction, disableIdleParkAction } from "@/server/actions/automation";
import { Pause, Power } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AutoParkPage() {
  const policies = await db.select().from(idleParkPolicies).orderBy(desc(idleParkPolicies.createdAt));
  const allInstances = await db.select().from(instances).orderBy(instances.name);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <Pause className="h-6 w-6 text-[var(--color-primary)]" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Idle VM auto-park</h1>
          <p className="text-sm text-muted">Stop VMs that show no activity for N minutes. Opt-in per VM. Re-park cooldown is 24h.</p>
        </div>
      </header>

      <form action={async (fd) => {
        "use server";
        const [accountId, providerInstanceId] = String(fd.get("target") ?? "").split("|");
        if (!accountId || !providerInstanceId) return;
        await setIdleParkPolicyAction({
          accountId, providerInstanceId,
          cpuPct: Number(fd.get("cpuPct") ?? 5),
          netKbps: Number(fd.get("netKbps") ?? 50),
          windowMin: Number(fd.get("windowMin") ?? 30),
          enabled: true,
        });
      }} className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 sm:grid-cols-5">
        <select name="target" required className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-sm">
          <option value="">Pick a VM…</option>
          {allInstances.map((i) => (
            <option key={i.id} value={`${i.accountId}|${i.providerInstanceId}`}>{i.name} · {i.region}</option>
          ))}
        </select>
        <label className="text-xs text-muted">CPU% <input name="cpuPct" type="number" min={1} max={50} defaultValue={5} className="ml-1 w-16 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1 py-1 text-sm" /></label>
        <label className="text-xs text-muted">Net Kb/s <input name="netKbps" type="number" min={1} max={10000} defaultValue={50} className="ml-1 w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1 py-1 text-sm" /></label>
        <label className="text-xs text-muted">Window min <input name="windowMin" type="number" min={5} max={720} defaultValue={30} className="ml-1 w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1 py-1 text-sm" /></label>
        <button className="rounded bg-[var(--color-primary)] px-3 py-1 text-sm text-white">Enable</button>
      </form>

      {policies.length === 0 ? (
        <p className="text-center text-xs text-muted">No auto-park policies yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-2 py-2">VM</th><th>CPU max</th><th>Net max</th><th>Window</th><th>Status</th><th>Last parked</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {policies.map((p) => (
              <tr key={p.id}>
                <td className="px-2 py-2 font-mono text-xs">{p.providerInstanceId}</td>
                <td className="font-mono text-xs">{p.cpuPct}%</td>
                <td className="font-mono text-xs">{p.netKbps} kbps</td>
                <td className="font-mono text-xs">{p.windowMin}m</td>
                <td className="text-xs">{p.enabled ? "active" : "off"}</td>
                <td className="font-mono text-xs">{p.lastParkedAt ? p.lastParkedAt.toISOString().slice(0,16).replace("T"," ") : "—"}</td>
                <td className="text-right">
                  {p.enabled === 1 && (
                    <form action={async () => { "use server"; await disableIdleParkAction(p.id); }}>
                      <button className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-surface-muted)]">
                        <Power className="h-3 w-3" /> Disable
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
