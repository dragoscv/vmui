import "server-only";
import { db } from "@/lib/db";
import { snapshotHistory, cloudAccounts, instances } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface AccountTrend {
  accountId: string;
  accountName: string;
  startUsdPerHour: number;
  endUsdPerHour: number;
  deltaUsdPerHour: number;
  deltaPct: number;
  monthlyDeltaUsd: number;
  startInstances: number;
  endInstances: number;
}

export default async function BillExplainerPage() {
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const [snaps, accs, allInst] = await Promise.all([
    db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, since)),
    db.select().from(cloudAccounts),
    db.select().from(instances),
  ]);

  const byAccount = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const arr = byAccount.get(s.accountId) ?? [];
    if (!byAccount.has(s.accountId)) byAccount.set(s.accountId, arr);
    arr.push(s);
  }

  const trends: AccountTrend[] = [];
  for (const a of accs) {
    const items = byAccount.get(a.id);
    if (!items || items.length < 2) continue;
    items.sort((x, y) => x.capturedAt.getTime() - y.capturedAt.getTime());
    const first = items[0]!; const last = items[items.length - 1]!;
    const delta = last.hourlyUsd - first.hourlyUsd;
    const pct = first.hourlyUsd > 0 ? (delta / first.hourlyUsd) * 100 : 0;
    trends.push({
      accountId: a.id, accountName: a.name,
      startUsdPerHour: first.hourlyUsd, endUsdPerHour: last.hourlyUsd,
      deltaUsdPerHour: delta, deltaPct: pct,
      monthlyDeltaUsd: delta * 24 * 30,
      startInstances: first.runningInstances, endInstances: last.runningInstances,
    });
  }
  trends.sort((a, b) => Math.abs(b.deltaUsdPerHour) - Math.abs(a.deltaUsdPerHour));

  const instanceCounts = new Map<string, number>();
  for (const i of allInst) {
    const k = `${i.provider}:${i.instanceType ?? "unknown"}`;
    instanceCounts.set(k, (instanceCounts.get(k) ?? 0) + 1);
  }
  const topTypes = [...instanceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Bill explainer</h1>
        <p className="text-sm text-zinc-400">Heuristic 7-day delta of per-account spend. Top movers ranked by absolute monthly impact.</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Top spend movers (last 7d)</h2>
        {trends.length === 0 && <div className="text-sm text-zinc-500">Not enough snapshot history.</div>}
        <div className="space-y-2">
          {trends.slice(0, 10).map((t) => {
            const arrow = t.deltaUsdPerHour > 0 ? "↑" : t.deltaUsdPerHour < 0 ? "↓" : "→";
            const color = t.deltaUsdPerHour > 0.001 ? "text-rose-400" : t.deltaUsdPerHour < -0.001 ? "text-emerald-400" : "text-zinc-400";
            return (
              <div key={t.accountId} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{t.accountName}</div>
                  <div className={`font-mono ${color}`}>{arrow} ${Math.abs(t.monthlyDeltaUsd).toFixed(2)}/mo ({t.deltaPct >= 0 ? "+" : ""}{t.deltaPct.toFixed(0)}%)</div>
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  ${t.startUsdPerHour.toFixed(4)}/h ({t.startInstances} VMs) → ${t.endUsdPerHour.toFixed(4)}/h ({t.endInstances} VMs)
                </div>
                {t.endInstances !== t.startInstances && (
                  <div className="mt-1 text-xs text-amber-400">{t.endInstances - t.startInstances > 0 ? "+" : ""}{t.endInstances - t.startInstances} VM count change</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Top instance types in fleet</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-2 text-left">Provider</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-right">Count</th></tr></thead>
            <tbody>
              {topTypes.map(([k, n]) => {
                const idx = k.indexOf(":");
                const prov = k.slice(0, idx);
                const t = k.slice(idx + 1);
                return (
                  <tr key={k} className="border-t border-zinc-900">
                    <td className="px-3 py-2 text-xs">{prov}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t}</td>
                    <td className="px-3 py-2 text-right">{n}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-zinc-500">
          For per-account forecast see <Link className="text-emerald-300 hover:text-emerald-200" href="/account-forecast">/account-forecast</Link>; for resize candidates see <Link className="text-emerald-300 hover:text-emerald-200" href="/cost-recos">/cost-recos</Link>.
        </div>
      </section>
    </div>
  );
}
