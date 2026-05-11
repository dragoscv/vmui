import "server-only";
import { db } from "@/lib/db";
import { accountBudgets, cloudAccounts, snapshotHistory } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import { setAccountBudgetAction, deleteAccountBudgetAction } from "@/server/actions/templates-and-budgets";

export const dynamic = "force-dynamic";

async function save(formData: FormData) {
  "use server";
  await setAccountBudgetAction({
    accountId: String(formData.get("accountId") ?? ""),
    monthlyUsd: Number(formData.get("monthlyUsd") ?? 0),
  });
}

async function remove(formData: FormData) {
  "use server";
  await deleteAccountBudgetAction(String(formData.get("accountId") ?? ""));
}

export default async function AccountBudgetsPage() {
  const [accs, budgets, recentSnaps] = await Promise.all([
    db.select().from(cloudAccounts),
    db.select().from(accountBudgets),
    db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, new Date(Date.now() - 24 * 3600_000))),
  ]);
  const budgetMap = new Map(budgets.map((b) => [b.accountId, b]));
  const projected = new Map<string, number>();
  for (const s of recentSnaps) {
    const cur = projected.get(s.accountId) ?? 0;
    if (s.hourlyUsd > cur) projected.set(s.accountId, s.hourlyUsd);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Per-account budgets</h1>
        <p className="text-sm text-zinc-400">
          Alerts fire when projected monthly spend reaches 80% of the cap.
        </p>
      </header>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-left">Provider</th><th className="px-3 py-2 text-right">Projected $/mo</th><th className="px-3 py-2 text-right">Cap</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {accs.map((a) => {
              const monthly = (projected.get(a.id) ?? 0) * 24 * 30;
              const b = budgetMap.get(a.id);
              const pct = b && b.monthlyUsd > 0 ? monthly / b.monthlyUsd : 0;
              const status = !b ? "—" : pct >= 1 ? "OVER" : pct >= 0.8 ? "Warn" : "OK";
              const statusColor = status === "OVER" ? "text-rose-400" : status === "Warn" ? "text-amber-400" : status === "OK" ? "text-emerald-400" : "text-zinc-500";
              return (
                <tr key={a.id} className="border-t border-zinc-900">
                  <td className="px-3 py-2">{a.name}</td>
                  <td className="px-3 py-2 text-xs font-mono">{a.provider}</td>
                  <td className="px-3 py-2 text-right">${monthly.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    <form action={save} className="inline-flex items-center gap-1">
                      <input type="hidden" name="accountId" value={a.id} />
                      <input type="number" step="0.01" min="0" name="monthlyUsd" defaultValue={b?.monthlyUsd ?? 0}
                        className="w-24 rounded-md bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-right" />
                      <button type="submit" className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-0.5 text-xs">Save</button>
                    </form>
                  </td>
                  <td className={`px-3 py-2 text-xs ${statusColor}`}>{status}{b?.alertedAt ? ` · alerted ${b.alertedAt.toLocaleDateString()}` : ""}</td>
                  <td className="px-3 py-2 text-right">
                    {b && (
                      <form action={remove} className="inline">
                        <input type="hidden" name="accountId" value={a.id} />
                        <button type="submit" className="text-rose-300 hover:text-rose-200 text-xs">Clear</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
