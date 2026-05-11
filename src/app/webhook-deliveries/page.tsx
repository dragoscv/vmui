import "server-only";
import { db } from "@/lib/db";
import { webhookDeliveries } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function WebhookDeliveriesPage() {
  const rows = await db.select().from(webhookDeliveries).orderBy(desc(webhookDeliveries.createdAt)).limit(200);
  const counts = { queued: 0, delivering: 0, ok: 0, failed: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Webhook deliveries</h1>
        <p className="text-sm text-zinc-400">Outbound webhooks with exponential backoff retry. Max 5 attempts; backoff 30s × 2^n up to 1h.</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        {(["queued", "delivering", "ok", "failed"] as const).map((s) => (
          <div key={s} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="text-xs text-zinc-500 uppercase">{s}</div>
            <div className={`text-xl font-mono ${s === "failed" ? "text-rose-300" : s === "ok" ? "text-emerald-300" : "text-zinc-200"}`}>{counts[s] ?? 0}</div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500"><tr>
            <th className="px-3 py-2 text-left">URL</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Attempts</th><th className="px-3 py-2 text-left">Next/at</th><th className="px-3 py-2 text-left">Last error</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-900">
                <td className="px-3 py-2 font-mono text-xs truncate max-w-md" title={r.url}>{r.url}</td>
                <td className="px-3 py-2 text-xs">
                  <span className={r.status === "ok" ? "text-emerald-300" : r.status === "failed" ? "text-rose-300" : r.status === "delivering" ? "text-amber-300" : "text-zinc-400"}>{r.status}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">{r.attempts}/{r.maxAttempts}</td>
                <td className="px-3 py-2 text-xs font-mono text-zinc-500">{r.deliveredAt ? r.deliveredAt.toLocaleString() : r.nextAttemptAt.toLocaleString()}</td>
                <td className="px-3 py-2 text-xs text-rose-300 truncate max-w-xs" title={r.lastErrorMessage ?? ""}>{r.lastErrorMessage ?? ""}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500 text-sm">No deliveries yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
