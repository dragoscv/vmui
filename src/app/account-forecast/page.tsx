import "server-only";
import { AccountForecastCards } from "@/components/cloud/account-forecast-cards";
import { PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { snapshotHistory, cloudAccounts, accountBudgets } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import { LineChart } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

interface DailyPoint { day: string; ts: number; usd: number; }

function linRegress(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumXX = points.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export default async function AccountForecastPage() {
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const [t, snaps, accs, budgets] = await Promise.all([
    getTranslations("cloud.accountForecast"),
    db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, since)),
    db.select().from(cloudAccounts),
    db.select().from(accountBudgets),
  ]);

  const budgetMap = new Map(budgets.map((b) => [b.accountId, b.monthlyUsd]));
  const byAccount = new Map<string, Map<string, number>>();
  for (const s of snaps) {
    const day = s.capturedAt.toISOString().slice(0, 10);
    let acct = byAccount.get(s.accountId);
    if (!acct) { acct = new Map(); byAccount.set(s.accountId, acct); }
    const cur = acct.get(day) ?? 0;
    if (s.hourlyUsd > cur) acct.set(day, s.hourlyUsd);
  }

  interface Forecast {
    accountId: string; accountName: string; daily: DailyPoint[];
    projected30dUsd: number; slopePerDay: number; budget: number | null; pctOfBudget: number | null;
  }
  const forecasts: Forecast[] = [];
  for (const a of accs) {
    const days = byAccount.get(a.id);
    if (!days || days.size === 0) continue;
    const sorted = [...days.entries()].sort(([x], [y]) => x.localeCompare(y));
    const daily: DailyPoint[] = sorted.map(([day, hourly]) => ({ day, ts: Date.parse(day), usd: hourly * 24 }));
    const points = daily.map((d, i) => ({ x: i, y: d.usd }));
    const { slope, intercept } = linRegress(points);
    const lastIdx = points.length - 1;
    let projected = 0;
    for (let i = 1; i <= 30; i++) projected += Math.max(0, intercept + slope * (lastIdx + i));
    const budget = budgetMap.get(a.id) ?? null;
    forecasts.push({
      accountId: a.id, accountName: a.name, daily,
      projected30dUsd: projected, slopePerDay: slope, budget,
      pctOfBudget: budget ? projected / budget : null,
    });
  }
  forecasts.sort((a, b) => b.projected30dUsd - a.projected30dUsd);

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<LineChart />} />
      <AccountForecastCards
        forecasts={forecasts.map((f) => ({
          accountId: f.accountId,
          accountName: f.accountName,
          daily: f.daily.map((d) => d.usd),
          projected30dUsd: f.projected30dUsd,
          slopePerDay: f.slopePerDay,
          budget: f.budget,
        }))}
      />
    </PageShell>
  );
}
