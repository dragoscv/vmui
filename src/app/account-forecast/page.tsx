import "server-only";
import { db } from "@/lib/db";
import { snapshotHistory, cloudAccounts, accountBudgets } from "@/lib/db/schema";
import { gte } from "drizzle-orm";

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
  const [snaps, accs, budgets] = await Promise.all([
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
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Per-account spend forecast</h1>
        <p className="text-sm text-zinc-400">30-day projection per account via linear regression of daily peak spend.</p>
      </header>
      {forecasts.length === 0 && <div className="text-sm text-zinc-500">Not enough history yet.</div>}
      <div className="space-y-3">
        {forecasts.map((f) => (
          <div key={f.accountId} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">{f.accountName}</div>
              <div className="text-xs text-zinc-500">slope ${f.slopePerDay.toFixed(2)}/day{f.budget ? ` · cap $${f.budget.toFixed(0)}/mo` : ""}</div>
            </div>
            <div className="mt-3 flex items-center gap-6">
              <div>
                <div className="text-2xl font-semibold">${f.projected30dUsd.toFixed(0)}</div>
                <div className="text-xs text-zinc-500">projected next 30d</div>
              </div>
              {f.pctOfBudget !== null && (
                <div>
                  <div className={`text-2xl font-semibold ${f.pctOfBudget >= 1 ? "text-rose-400" : f.pctOfBudget >= 0.8 ? "text-amber-400" : "text-emerald-400"}`}>
                    {(f.pctOfBudget * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-zinc-500">of monthly cap</div>
                </div>
              )}
              <Sparkline daily={f.daily} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({ daily }: { daily: DailyPoint[] }) {
  if (daily.length < 2) return null;
  const W = 220, H = 50, P = 2;
  const xs = daily.map((d) => d.ts);
  const ys = daily.map((d) => d.usd);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMax = Math.max(...ys, 1);
  const sx = (x: number) => P + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - 2 * P);
  const sy = (y: number) => H - P - (y / yMax) * (H - 2 * P);
  const path = daily.map((d, i) => `${i === 0 ? "M" : "L"} ${sx(d.ts).toFixed(1)} ${sy(d.usd).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} className="ml-auto">
      <path d={path} stroke="rgb(52, 211, 153)" fill="none" strokeWidth={1.5} />
    </svg>
  );
}
