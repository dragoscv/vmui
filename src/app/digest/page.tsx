import { db } from "@/lib/db";
import { auditLog, instances } from "@/lib/db/schema";
import { gte, desc } from "drizzle-orm";
import { Activity, AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function DigestPage({ searchParams }: { searchParams: Promise<{ hours?: string }> }) {
  const sp = await searchParams;
  const hours = Math.max(1, Math.min(168, Number(sp.hours ?? 1)));
  const since = new Date(Date.now() - hours * 3600_000);
  const events = await db.select().from(auditLog).where(gte(auditLog.createdAt, since)).orderBy(desc(auditLog.createdAt)).limit(500);
  const fleet = await db.select().from(instances);

  const byAction = new Map<string, number>();
  let errors = 0;
  for (const e of events) {
    byAction.set(e.action, (byAction.get(e.action) ?? 0) + 1);
    if (e.status === "error") errors++;
  }
  const top = [...byAction.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const stateCounts = new Map<string, number>();
  for (const i of fleet) stateCounts.set(i.state, (stateCounts.get(i.state) ?? 0) + 1);

  const headline = errors === 0
    ? `${events.length} actions in the last ${hours}h, all clean.`
    : `${events.length} actions in the last ${hours}h — ${errors} error${errors === 1 ? "" : "s"} to look at.`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-[var(--color-primary)]" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">What changed</h1>
          <p className="text-sm text-muted">{headline}</p>
        </div>
        <div className="ml-auto flex gap-1 text-xs">
          {[1, 6, 24, 168].map((h) => (
            <a key={h} href={`?hours=${h}`} className={`rounded border px-2 py-1 ${h === hours ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15" : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"}`}>
              {h === 168 ? "7d" : `${h}h`}
            </a>
          ))}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Events" value={String(events.length)} icon={<Activity className="h-4 w-4 text-[var(--color-primary)]" />} />
        <Stat label="Errors" value={String(errors)} icon={errors > 0 ? <AlertTriangle className="h-4 w-4 text-rose-300" /> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />} />
        <Stat label="Fleet running" value={`${stateCounts.get("running") ?? 0} / ${fleet.length}`} />
      </div>

      <section className="rounded-lg border border-[var(--color-border)]">
        <h2 className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-medium text-muted">Top actions</h2>
        <ul className="divide-y divide-[var(--color-border)] text-sm">
          {top.length === 0 ? (
            <li className="p-4 text-center text-xs text-muted">No activity in this window.</li>
          ) : top.map(([action, count]) => {
            const max = top[0]?.[1] ?? 1;
            const pct = (count / max) * 100;
            return (
              <li key={action} className="flex items-center gap-3 px-3 py-2">
                <span className="font-mono text-xs">{action}</span>
                <div className="ml-auto h-1.5 w-40 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
                  <div className="h-full bg-[var(--color-primary)]" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-right font-mono text-xs">{count}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-[var(--color-border)]">
        <h2 className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-medium text-muted">Recent errors</h2>
        <ul className="divide-y divide-[var(--color-border)] text-sm">
          {events.filter((e) => e.status === "error").slice(0, 20).map((e) => (
            <li key={e.id} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3 w-3 text-rose-300" />
                <span className="font-mono text-xs">{e.action}</span>
                <span className="text-xs text-muted">{e.target}</span>
                <span className="ml-auto font-mono text-[10px] text-muted">{e.createdAt.toISOString().slice(11, 19)}</span>
              </div>
              {e.message && <p className="mt-1 line-clamp-2 text-xs text-muted">{e.message}</p>}
            </li>
          ))}
          {events.filter((e) => e.status === "error").length === 0 && (
            <li className="p-4 text-center text-xs text-muted">No errors. Sip your coffee.</li>
          )}
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
        {icon}
      </div>
      <div className="mt-1 font-mono text-xl">{value}</div>
    </div>
  );
}
