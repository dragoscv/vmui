import "server-only";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { eq, gte, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function HeatmapPage() {
  const days = 84; // 12 weeks
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.select().from(auditLog).where(gte(auditLog.createdAt, since));

  const errByDay = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "error") continue;
    const k = r.createdAt.toISOString().slice(0, 10);
    errByDay.set(k, (errByDay.get(k) ?? 0) + 1);
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cells: { day: Date; key: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const k = d.toISOString().slice(0, 10);
    cells.push({ day: d, key: k, count: errByDay.get(k) ?? 0 });
  }

  // Group by week (cols of 7 rows). Find offset to start on Sunday column.
  const weeks: typeof cells[] = [];
  let buffer: typeof cells = [];
  for (const c of cells) {
    buffer.push(c);
    if (c.day.getDay() === 6) { weeks.push(buffer); buffer = []; }
  }
  if (buffer.length > 0) weeks.push(buffer);

  function shade(n: number): string {
    if (n === 0) return "bg-zinc-900";
    if (n < 3) return "bg-rose-900/60";
    if (n < 8) return "bg-rose-700/70";
    if (n < 20) return "bg-rose-500/80";
    return "bg-rose-400";
  }

  const recentErrors = await db.select().from(auditLog)
    .where(eq(auditLog.status, "error"))
    .orderBy(desc(auditLog.createdAt))
    .limit(10);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Error heatmap</h1>
        <p className="text-sm text-zinc-400">Audit-log errors over the last {days} days.</p>
      </header>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 overflow-x-auto">
        <div className="flex gap-1">
          {weeks.map((w, i) => (
            <div key={i} className="flex flex-col gap-1">
              {w.map((c) => (
                <div
                  key={c.key}
                  className={`h-3.5 w-3.5 rounded-sm ${shade(c.count)} hover:ring-1 hover:ring-zinc-500`}
                  title={`${c.key}: ${c.count} error${c.count === 1 ? "" : "s"}`}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          <span>fewer</span>
          <div className="h-3 w-3 rounded-sm bg-zinc-900" />
          <div className="h-3 w-3 rounded-sm bg-rose-900/60" />
          <div className="h-3 w-3 rounded-sm bg-rose-700/70" />
          <div className="h-3 w-3 rounded-sm bg-rose-500/80" />
          <div className="h-3 w-3 rounded-sm bg-rose-400" />
          <span>more</span>
        </div>
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 px-4 py-2 text-sm font-medium">Recent errors</div>
        {recentErrors.length === 0 ? (
          <div className="px-4 py-3 text-zinc-500 text-sm">No errors logged.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-zinc-500"><tr><th className="px-4 py-2 text-left">When</th><th className="px-4 py-2 text-left">Action</th><th className="px-4 py-2 text-left">Target</th><th className="px-4 py-2 text-left">Message</th></tr></thead>
            <tbody>
              {recentErrors.map((r) => (
                <tr key={r.id} className="border-t border-zinc-900">
                  <td className="px-4 py-2 text-zinc-400 whitespace-nowrap">{r.createdAt.toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.target ?? ""}</td>
                  <td className="px-4 py-2 text-zinc-300 truncate max-w-md">{r.message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
