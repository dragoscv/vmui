import "server-only";

import { eq, and, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts, instances } from "@/lib/db/schema";
import { detectIdle } from "@/lib/idle";

export type AccountHealth = "ok" | "warn" | "bad";

export interface AccountHealthSummary {
  accountId: string;
  health: AccountHealth;
  idleCount: number;
  errors24h: number;
  lastSyncAt: Date | null;
  reasons: string[];
}

/**
 * Cheap per-account health. Combines:
 *  - last successful sync recency
 *  - error rate over the last 24h in audit_log
 *  - count of "possibly idle" running instances
 *
 * Returns the worst-of signal. Used for the dashboard summary badge so the
 * user can spot trouble at a glance.
 */
export async function summarizeAccountHealth(): Promise<Map<string, AccountHealthSummary>> {
  const accs = await db.select().from(cloudAccounts);
  const insts = await db.select().from(instances);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentErrors = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.status, "error"), gte(auditLog.createdAt, since)));

  const out = new Map<string, AccountHealthSummary>();
  for (const a of accs) {
    const accInsts = insts.filter((i) => i.accountId === a.id);
    const idle = accInsts.filter((i) =>
      detectIdle({ state: i.state, lastStateChangeAt: i.lastStateChangeAt }).isIdle,
    );
    const errs = recentErrors.filter((e) => e.accountId === a.id);
    const lastSync = accInsts.reduce<Date | null>((acc, r) => {
      if (!r.lastSyncedAt) return acc;
      if (!acc || r.lastSyncedAt > acc) return r.lastSyncedAt;
      return acc;
    }, null);

    const reasons: string[] = [];
    let health: AccountHealth = "ok";
    const bump = (next: AccountHealth) => {
      if (next === "bad") health = "bad";
      else if (next === "warn" && health !== "bad") health = "warn";
    };
    if (lastSync && Date.now() - lastSync.getTime() > 7 * 24 * 60 * 60 * 1000) {
      bump("bad");
      reasons.push(`No sync in ${Math.floor((Date.now() - lastSync.getTime()) / 86_400_000)}d`);
    } else if (lastSync && Date.now() - lastSync.getTime() > 24 * 60 * 60 * 1000) {
      bump("warn");
      reasons.push(`Last sync ${Math.floor((Date.now() - lastSync.getTime()) / 3_600_000)}h ago`);
    }
    if (errs.length >= 5) {
      bump("bad");
      reasons.push(`${errs.length} errors in 24h`);
    } else if (errs.length > 0) {
      bump("warn");
      reasons.push(`${errs.length} error(s) in 24h`);
    }
    if (idle.length > 0) {
      bump("warn");
      reasons.push(`${idle.length} idle VM(s)`);
    }
    out.set(a.id, {
      accountId: a.id,
      health,
      idleCount: idle.length,
      errors24h: errs.length,
      lastSyncAt: lastSync,
      reasons,
    });
  }
  return out;
}
