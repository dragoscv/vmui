import "server-only";
import { db } from "@/lib/db";
import { auditLog, instances, backupJobs } from "@/lib/db/schema";
import { gte, eq, and, desc, sql } from "drizzle-orm";
import Link from "next/link";

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
    <div className="border-b border-rose-500/40 bg-rose-950/40 text-rose-100 px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex h-2 w-2 rounded-full bg-rose-400 animate-pulse shrink-0" />
          <span className="font-medium">
            {total} active issue{total === 1 ? "" : "s"}:
          </span>
          <span className="text-rose-200 truncate">
            {errs > 0 && <span className="mr-3">{errs} action error{errs === 1 ? "" : "s"}</span>}
            {vms > 0 && <span className="mr-3">{vms} VM{vms === 1 ? "" : "s"} in unknown state</span>}
            {backups > 0 && <span>{backups} failed backup{backups === 1 ? "" : "s"}</span>}
          </span>
        </div>
        <Link href="/activity" className="text-rose-100 hover:text-white shrink-0 underline-offset-2 hover:underline">
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
