import { db } from "@/lib/db";
import { tagBudgets } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { upsertTagBudgetAction, deleteTagBudgetAction } from "@/server/actions/automation";
import { PiggyBank, Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const rows = await db.select().from(tagBudgets).orderBy(desc(tagBudgets.createdAt));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <PiggyBank className="h-6 w-6 text-[var(--color-primary)]" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tag budgets</h1>
          <p className="text-sm text-muted">Set a monthly cap per tag and get notified before you hit it.</p>
        </div>
      </header>

      <form action={async (fd) => {
        "use server";
        await upsertTagBudgetAction({
          tagKey: String(fd.get("tagKey") ?? ""),
          tagValue: String(fd.get("tagValue") ?? ""),
          monthlyUsd: Number(fd.get("monthlyUsd") ?? 0),
        });
      }} className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 sm:grid-cols-4">
        <input name="tagKey" required placeholder="tag key (env)" className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-sm" />
        <input name="tagValue" required placeholder="tag value (prod)" className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-sm" />
        <input name="monthlyUsd" type="number" min="1" step="1" required placeholder="USD/mo" className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-sm" />
        <button className="rounded bg-[var(--color-primary)] px-3 py-1 text-sm text-white">Save</button>
      </form>

      {rows.length === 0 ? (
        <p className="text-center text-xs text-muted">No budgets yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-2 py-2">Tag</th><th>Cap</th><th>Observed</th><th>Status</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-2 py-2 font-mono text-xs">{r.tagKey}:{r.tagValue ?? "*"}</td>
                <td className="font-mono text-xs">${r.monthlyUsd.toFixed(0)}/mo</td>
                <td className="font-mono text-xs">{r.lastObservedUsd != null ? `$${r.lastObservedUsd.toFixed(2)}` : "—"}</td>
                <td className="text-xs">{r.exceeded ? <span className="text-rose-300">exceeded</span> : "ok"}</td>
                <td className="text-right">
                  <form action={async () => { "use server"; await deleteTagBudgetAction(r.id); }}>
                    <button className="inline-flex items-center gap-1 rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
