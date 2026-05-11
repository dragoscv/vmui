import "server-only";
import { db } from "@/lib/db";
import { snapshotHistory, cloudAccounts, instances } from "@/lib/db/schema";
import { desc, gte } from "drizzle-orm";
import { priceInstances } from "@/lib/pricing";
import { HOURS_PER_MONTH } from "@/lib/utils";

export interface CostAnomaly {
  accountId: string;
  accountName: string;
  currentHourly: number;
  median7dHourly: number;
  ratio: number;
  message: string;
}

/**
 * Compares the latest hourly burn against the 7-day median per account and
 * flags accounts where the current burn is more than 2× the median (and at
 * least $0.10/hr above it). Used by the dashboard to render a top banner.
 */
export async function detectCostAnomalies(): Promise<CostAnomaly[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const accounts = await db.select().from(cloudAccounts);
  const instancesAll = await db.select().from(instances);
  const priceMap = await priceInstances(
    instancesAll
      .filter((i) => i.state === "running")
      .map((i) => ({
        id: i.id,
        provider: i.provider,
        region: i.region,
        instanceType: i.instanceType,
        platform: i.platform,
        accountId: i.accountId,
      })),
  );

  const out: CostAnomaly[] = [];
  for (const acc of accounts) {
    const rows = await db
      .select()
      .from(snapshotHistory)
      .where(
        // any captured_at >= since
        // drizzle: gte(snapshotHistory.capturedAt, since) needs a date object
        // we'll do it at query time below
        gte(snapshotHistory.capturedAt, since),
      )
      .orderBy(desc(snapshotHistory.capturedAt));
    const accRows = rows.filter((r) => r.accountId === acc.id);
    if (accRows.length < 4) continue;

    const sorted = accRows.map((r) => r.hourlyUsd).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : sorted[mid] ?? 0;

    const current = instancesAll
      .filter((i) => i.accountId === acc.id && i.state === "running")
      .reduce((sum, i) => sum + (priceMap[i.id]?.usdPerHour ?? 0), 0);

    const ratio = median > 0 ? current / median : 0;
    if (current >= median + 0.1 && (ratio >= 2 || median === 0 && current >= 0.5)) {
      out.push({
        accountId: acc.id,
        accountName: acc.name,
        currentHourly: current,
        median7dHourly: median,
        ratio,
        message: `Hourly burn $${current.toFixed(2)} is ${ratio > 0 ? `${ratio.toFixed(1)}× ` : ""}higher than the 7-day median ($${median.toFixed(2)}). That projects to $${(current * HOURS_PER_MONTH).toFixed(0)}/mo if sustained.`,
      });
    }
  }
  return out;
}
