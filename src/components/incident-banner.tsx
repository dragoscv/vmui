import { db } from "@/lib/db";
import { auditLog, backupJobs, instances } from "@/lib/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import "server-only";

/** Aggregates "what's broken right now" across audit, instances, backups. */
export async function IncidentBanner() {
  const since = new Date(Date.now() - 60 * 60_000); // last hour

  const [recentErrors, errorVms, failedBackups] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(auditLog).where(and(eq(auditLog.status, "error"), gte(auditLog.createdAt, since))),
    db.select({ c: sql<number>`count(*)` }).from(instances).where(eq(instances.state, "unknown")),
    db.select({ c: sql<number>`count(*)` }).from(backupJobs).where(and(eq(backupJobs.status, "error"), gte(backupJobs.startedAt, since))),
  ]);

  const errs = recentErrors[0]?.c ?? 0;
  const vms = errorVms[0]?.c ?? 0;
  const backups = failedBackups[0]?.c ?? 0;
  const total = errs + vms + backups;
  if (total === 0) return null;

  const recent = await db.select({ a: auditLog.action, t: auditLog.target, m: auditLog.message })
    .from(auditLog)
    .where(and(eq(auditLog.status, "error"), gte(auditLog.createdAt, since)))
    .orderBy(desc(auditLog.createdAt))
    .limit(3);

  return (
    <div className="border-b border-rose-500/40 bg-rose-950/40 px-4 py-2 text-sm text-rose-100">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-400" />
          <span className="shrink-0 font-medium">
            {total} active issue{total === 1 ? "" : "s"}:
          </span>
          <span className="flex min-w-0 flex-wrap gap-x-3 text-rose-200">
            {errs > 0 && <span className="whitespace-nowrap">{errs} action error{errs === 1 ? "" : "s"}</span>}
            {vms > 0 && <span className="whitespace-nowrap">{vms} VM{vms === 1 ? "" : "s"} in unknown state</span>}
            {backups > 0 && <span className="whitespace-nowrap">{backups} failed backup{backups === 1 ? "" : "s"}</span>}
          </span>
        </div>
        <Link href="/activity" className="ml-auto shrink-0 whitespace-nowrap rounded px-1 py-0.5 text-rose-100 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
          view activity →
        </Link>
      </div>
      {recent.length > 0 && (
        <div className="mt-1 text-xs text-rose-200/80 truncate">
          last: {recent.map((r) => `${r.a}${r.t ? ` (${r.t})` : ""}${r.m ? ` — ${r.m.slice(0, 60)}` : ""}`).join(" · ")}
        </div>
      )}
    </div>
  );
}
