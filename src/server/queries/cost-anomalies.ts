import "server-only";
import { db } from "@/lib/db";
import { cloudAccounts, snapshotHistory } from "@/lib/db/schema";
import { gte } from "drizzle-orm";

export interface CostAnomaly {
  accountId: string;
  accountName: string;
  provider: string;
  day: string;
  hourlyUsd: number;
  trailingAvgUsd: number;
  ratio: number;
  severity: "info" | "warn" | "alert";
}

/**
 * Detect daily cost spikes by bucketing snapshot_history into days, computing
 * a 7-day trailing average per account, and flagging days where the average
 * hourly spend exceeds 1.25x (info), 1.5x (warn), or 2x (alert) the trailing
 * baseline. Requires at least 8 days of data per account.
 */
export async function detectCostAnomalies(windowDays = 30): Promise<CostAnomaly[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, since));
  if (rows.length === 0) return [];
  const accounts = await db.select().from(cloudAccounts);
  const acctMap = new Map(accounts.map((a) => [a.id, a]));

  const byAcct = new Map<string, Map<string, { sum: number; n: number }>>();
  for (const r of rows) {
    const day = new Date(r.capturedAt).toISOString().slice(0, 10);
    let perDay = byAcct.get(r.accountId);
    if (!perDay) {
      perDay = new Map();
      byAcct.set(r.accountId, perDay);
    }
    const cur = perDay.get(day) ?? { sum: 0, n: 0 };
    cur.sum += r.hourlyUsd;
    cur.n += 1;
    perDay.set(day, cur);
  }

  const anomalies: CostAnomaly[] = [];
  for (const [acctId, perDay] of byAcct) {
    const days = [...perDay.keys()].sort();
    if (days.length < 8) continue;
    const avgs = days.map((d) => {
      const v = perDay.get(d)!;
      return { d, avg: v.sum / v.n };
    });
    for (let i = 7; i < avgs.length; i++) {
      const window = avgs.slice(i - 7, i);
      const baseline = window.reduce((s, x) => s + x.avg, 0) / window.length;
      if (baseline <= 0.0001) continue;
      const today = avgs[i]!;
      const ratio = today.avg / baseline;
      if (ratio < 1.25) continue;
      const sev: CostAnomaly["severity"] = ratio >= 2 ? "alert" : ratio >= 1.5 ? "warn" : "info";
      const acc = acctMap.get(acctId);
      anomalies.push({
        accountId: acctId,
        accountName: acc?.name ?? "(unknown)",
        provider: acc?.provider ?? "?",
        day: today.d,
        hourlyUsd: today.avg,
        trailingAvgUsd: baseline,
        ratio,
        severity: sev,
      });
    }
  }
  anomalies.sort((a, b) => (a.day < b.day ? 1 : -1));
  return anomalies.slice(0, 50);
}
