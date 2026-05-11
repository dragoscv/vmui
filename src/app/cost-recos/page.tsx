import "server-only";
import { generateCostRecommendations } from "@/lib/cost-recos";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CostRecosPage() {
  const recos = await generateCostRecommendations(50);
  const total = recos.reduce((s, r) => s + r.monthlySavingsUsd, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Cost recommendations</h1>
        <p className="text-sm text-zinc-400">
          Heuristic suggestions to downsize idle VMs. Based on the last 7 days of probe data (CPU &lt; 10%, network &lt; 100 kbps).
        </p>
      </header>

      <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-5">
        <div className="text-xs uppercase text-emerald-400">Estimated total monthly savings</div>
        <div className="mt-1 text-3xl font-semibold text-emerald-300">${total.toFixed(2)}</div>
        <div className="mt-1 text-xs text-emerald-400/80">across {recos.length} VM{recos.length === 1 ? "" : "s"}</div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-2 text-left">VM</th><th className="px-3 py-2 text-left">Region</th><th className="px-3 py-2 text-left">Current</th><th className="px-3 py-2 text-left">Suggested</th><th className="px-3 py-2 text-right">Savings/mo</th><th className="px-3 py-2 text-left">Reason</th></tr></thead>
          <tbody>
            {recos.length === 0 && (<tr><td className="px-3 py-6 text-zinc-500" colSpan={6}>No idle VMs detected. Either you&rsquo;re running tight, or there isn&rsquo;t enough probe data yet.</td></tr>)}
            {recos.map((r) => (
              <tr key={r.instanceId} className="border-t border-zinc-900">
                <td className="px-3 py-2">
                  <Link href={`/instances/${encodeURIComponent(r.instanceId)}`} className="text-emerald-300 hover:text-emerald-200">{r.name}</Link>
                  <div className="text-[10px] text-zinc-500">{r.provider}</div>
                </td>
                <td className="px-3 py-2 text-xs">{r.region}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.current.type}
                  <div className="text-[10px] text-zinc-500">${r.current.usdPerHour.toFixed(4)}/hr</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-emerald-300">
                  {r.suggested?.type}
                  <div className="text-[10px] text-emerald-400/70">${r.suggested?.usdPerHour.toFixed(4)}/hr</div>
                </td>
                <td className="px-3 py-2 text-right font-medium text-emerald-300">${r.monthlySavingsUsd.toFixed(2)}</td>
                <td className="px-3 py-2 text-xs text-zinc-400">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
