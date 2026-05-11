import { db } from "@/lib/db";
import { instances, snapshotHistory, auditLog } from "@/lib/db/schema";
import { desc, and, eq, gte } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { CheckCircle2, XCircle, Activity } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 30;

interface StatusPayload {
  generatedAt: string;
  totalInstances: number;
  byState: Record<string, number>;
  byProvider: Record<string, number>;
  fleetHourlyUsd: number;
  recentErrors24h: number;
}

function signPayload(p: StatusPayload): string {
  const key = process.env.VMUI_MASTER_KEY ?? "";
  return createHmac("sha256", key).update(JSON.stringify(p)).digest("hex").slice(0, 16);
}

export default async function StatusPage() {
  const all = await db.select().from(instances).limit(1000);
  const byState: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  for (const i of all) {
    byState[i.state] = (byState[i.state] ?? 0) + 1;
    byProvider[i.provider] = (byProvider[i.provider] ?? 0) + 1;
  }
  const snap = db.select().from(snapshotHistory).orderBy(desc(snapshotHistory.capturedAt)).limit(1).get();
  const errs24h = db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.status, "error"), gte(auditLog.createdAt, new Date(Date.now() - 86_400_000))))
    .all().length;
  const payload: StatusPayload = {
    generatedAt: new Date().toISOString(),
    totalInstances: all.length,
    byState,
    byProvider,
    fleetHourlyUsd: snap?.hourlyUsd ?? 0,
    recentErrors24h: errs24h,
  };
  const sig = signPayload(payload);

  const running = byState["running"] ?? 0;
  const healthy = running > 0 && (byState["stopped"] ?? 0) < running;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="text-center">
        <div className={`mx-auto inline-flex items-center gap-2 rounded-full px-4 py-1 text-sm font-semibold ${healthy ? "bg-emerald-500/15 text-emerald-200" : "bg-rose-500/15 text-rose-200"}`}>
          {healthy ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {healthy ? "All systems operational" : "Degraded"}
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">vmui status</h1>
        <p className="text-xs text-muted">Public read-only snapshot. Generated {new Date(payload.generatedAt).toLocaleString()}.</p>
      </header>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Instances" value={payload.totalInstances.toString()} />
        <Stat label="Running" value={running.toString()} />
        <Stat label="Stopped" value={(byState["stopped"] ?? 0).toString()} />
        <Stat label="$/hr" value={`$${payload.fleetHourlyUsd.toFixed(2)}`} />
      </section>
      <section>
        <h2 className="mb-2 flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted"><Activity className="h-3 w-3" /> By provider</h2>
        <ul className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {Object.entries(payload.byProvider).map(([p, n]) => (
            <li key={p} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
              <span className="font-semibold">{p}</span> · {n}
            </li>
          ))}
        </ul>
      </section>
      <footer className="text-center text-[10px] text-muted">
        Signature <code className="font-mono">{sig}</code> · verify with <code className="font-mono">HMAC-SHA256(VMUI_MASTER_KEY, payload)</code>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-center">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
