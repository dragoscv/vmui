import { db } from "@/lib/db";
import { auditLog, backupJobs, instances } from "@/lib/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
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

  const [t, recent] = await Promise.all([
    getTranslations("shell.incident"),
    db.select({ a: auditLog.action, t: auditLog.target, m: auditLog.message })
      .from(auditLog)
      .where(and(eq(auditLog.status, "error"), gte(auditLog.createdAt, since)))
      .orderBy(desc(auditLog.createdAt))
      .limit(3),
  ]);

  return (
    <div
      role="status"
      className="mx-auto mb-4 w-full max-w-[var(--spacing-content)] rounded-3xl border border-[color-mix(in_oklch,var(--color-danger)_45%,var(--color-border))] bg-[color-mix(in_oklch,var(--color-danger)_12%,var(--color-surface))] px-5 py-2 text-sm text-fg shadow-[var(--shadow-sm)] sm:rounded-full"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
          <span className="shrink-0 font-medium">{t("issues", { n: total })}</span>
          <span className="flex min-w-0 flex-wrap gap-x-3 text-muted">
            {errs > 0 && <span className="whitespace-nowrap">{t("actionErrors", { n: errs })}</span>}
            {vms > 0 && <span className="whitespace-nowrap">{t("unknownVms", { n: vms })}</span>}
            {backups > 0 && <span className="whitespace-nowrap">{t("failedBackups", { n: backups })}</span>}
          </span>
        </div>
        <Link href="/activity" className="ml-auto shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger">
          {t("viewActivity")} →
        </Link>
      </div>
      {recent.length > 0 && (
        <div className="mt-1 truncate px-1 text-xs text-muted">
          {t("last")} {recent.map((r) => `${r.a}${r.t ? ` (${r.t})` : ""}${r.m ? ` — ${r.m.slice(0, 60)}` : ""}`).join(" · ")}
        </div>
      )}
    </div>
  );
}
