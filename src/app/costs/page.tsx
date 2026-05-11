import "server-only";
import { Suspense } from "react";
import { BarChart3, TrendingUp, AlertTriangle, Cloud, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
import { instances, cloudAccounts } from "@/lib/db/schema";
import { priceInstances } from "@/lib/pricing";
import { spotSavings } from "@/lib/pricing/spot";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExportButtons } from "@/components/ui/export-buttons";
import { IdleScanSection } from "@/components/costs/idle-scan-section";
import { CostForecastCard } from "@/components/costs/cost-forecast-card";
import { CostTrendCard } from "@/components/costs/cost-trend-card";
import { CostByTagCard } from "@/components/costs/cost-by-tag-card";
import { TagBudgetsCard } from "@/components/costs/tag-budgets-card";
import { CostAnomaliesCard } from "@/components/costs/cost-anomalies-card";
import { formatUsd, formatUsdPerHour, HOURS_PER_MONTH } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PerProvider {
  provider: string;
  hourly: number;
  count: number;
  running: number;
}

interface InstanceCost {
  id: string;
  name: string | null;
  provider: string;
  region: string;
  instanceType: string | null;
  state: string;
  hourly: number | null;
  source: string | null;
  fetchedAt: Date | null;
}

export default async function CostsPage() {
  const [accountList, instanceList] = await Promise.all([
    db.select().from(cloudAccounts),
    db.select().from(instances),
  ]);

  const priceMap = await priceInstances(
    instanceList.map((i) => ({
      id: i.id,
      provider: i.provider,
      region: i.region,
      instanceType: i.instanceType,
      platform: i.platform,
      accountId: i.accountId,
    })),
  );

  const rows: InstanceCost[] = instanceList.map((i) => {
    const p = priceMap[i.id];
    return {
      id: i.id,
      name: i.displayName ?? i.name,
      provider: i.provider,
      region: i.region,
      instanceType: i.instanceType,
      state: i.state,
      hourly: p?.usdPerHour ?? null,
      source: p?.source ?? null,
      fetchedAt: p?.fetchedAt ?? null,
    };
  });

  // Only running VMs accrue cost.
  const running = rows.filter((r) => r.state === "running");
  const totalHourly = running.reduce((s, r) => s + (r.hourly ?? 0), 0);
  const projectedMonthly = totalHourly * HOURS_PER_MONTH;

  const byProvider = new Map<string, PerProvider>();
  for (const r of rows) {
    const cur = byProvider.get(r.provider) ?? {
      provider: r.provider,
      hourly: 0,
      count: 0,
      running: 0,
    };
    cur.count++;
    if (r.state === "running") {
      cur.running++;
      cur.hourly += r.hourly ?? 0;
    }
    byProvider.set(r.provider, cur);
  }

  const providerRows = [...byProvider.values()].sort((a, b) => b.hourly - a.hourly);

  // Top spenders (running, with known price)
  const topSpenders = running
    .filter((r) => (r.hourly ?? 0) > 0)
    .sort((a, b) => (b.hourly ?? 0) - (a.hourly ?? 0))
    .slice(0, 8);

  // Idle detector: running with hourly cost but very low estimated utility.
  // Without metrics-history we use a heuristic — anything bigger than micro/small
  // tier that's been running idle is flagged. Real implementation would correlate
  // with CloudWatch/Azure Monitor history.
  const idleCandidates = running
    .filter((r) => (r.hourly ?? 0) >= 0.04)
    .sort((a, b) => (b.hourly ?? 0) - (a.hourly ?? 0))
    .slice(0, 6);

  const accountCount = accountList.length;
  const unpriced = running.filter((r) => r.hourly === null).length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BarChart3 className="h-6 w-6 text-[var(--color-primary)]" />
            Cost overview
          </h1>
          <p className="text-sm text-muted">
            Live view of running VMs across {accountCount} account{accountCount === 1 ? "" : "s"}.
            Pricing combines Azure Retail Prices live API + curated table for AWS / GCP / Scaleway.
          </p>
        </div>
        <ExportButtons
          filename={`vmui-costs-${new Date().toISOString().slice(0, 10)}`}
          rows={rows.map((r) => ({
            id: r.id,
            provider: r.provider,
            region: r.region,
            instanceType: r.instanceType,
            name: r.name,
            state: r.state,
            hourlyUsd: r.hourly,
            monthlyUsd: r.hourly !== null ? r.hourly * HOURS_PER_MONTH : null,
          }))}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-muted">
              <Sparkles className="h-4 w-4" />
              Hourly burn
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-tight">
              {formatUsdPerHour(totalHourly)}
            </div>
            <div className="mt-1 text-xs text-muted">
              {running.length} VM{running.length === 1 ? "" : "s"} running
            </div>
          </CardContent>
        </Card>

        <Card className="surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-muted">
              <TrendingUp className="h-4 w-4" />
              Projected month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-tight">{formatUsd(projectedMonthly)}</div>
            <div className="mt-1 text-xs text-muted">at {HOURS_PER_MONTH}h/mo</div>
          </CardContent>
        </Card>

        <Card className="surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-muted">
              <AlertTriangle className="h-4 w-4" />
              Unpriced
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-tight">{unpriced}</div>
            <div className="mt-1 text-xs text-muted">
              {unpriced > 0 ? "instance types not yet in pricing tables" : "every running VM is priced"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cloud className="h-4 w-4" /> By provider
          </CardTitle>
        </CardHeader>
        <CardContent>
          {providerRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">
              No instances yet.{" "}
              <Link href="/accounts" className="text-[var(--color-primary)] underline">
                Connect an account
              </Link>{" "}
              to see costs.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-2 text-left">Provider</th>
                    <th className="py-2 text-right">Running / Total</th>
                    <th className="py-2 text-right">Hourly</th>
                    <th className="py-2 text-right">Monthly</th>
                    <th className="py-2 text-right">% of total</th>
                  </tr>
                </thead>
                <tbody>
                  {providerRows.map((p) => {
                    const pct = totalHourly > 0 ? (p.hourly / totalHourly) * 100 : 0;
                    return (
                      <tr key={p.provider} className="border-t border-[var(--color-border)]">
                        <td className="py-2">
                          <Badge variant="info">{p.provider.toUpperCase()}</Badge>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {p.running}/{p.count}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {p.hourly > 0 ? formatUsdPerHour(p.hourly) : "—"}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {p.hourly > 0 ? formatUsd(p.hourly * HOURS_PER_MONTH) : "—"}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-muted">{pct.toFixed(0)}%</span>
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/5">
                              <div
                                className="h-full rounded-full bg-[var(--color-primary)]"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {topSpenders.length > 0 && (
        <Card className="surface">
          <CardHeader>
            <CardTitle className="text-base">Top spenders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-2 text-left">Instance</th>
                    <th className="py-2 text-left">Type</th>
                    <th className="py-2 text-left">Region</th>
                    <th className="py-2 text-right">Hourly</th>
                    <th className="py-2 text-right">Monthly</th>
                    <th className="py-2 text-left">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {topSpenders.map((r) => (
                    <tr key={r.id} className="border-t border-[var(--color-border)]">
                      <td className="py-2">
                        <Link href={`/instances/${encodeURIComponent(r.id)}`} className="hover:text-[var(--color-primary)]">
                          {r.name ?? r.id}
                        </Link>
                      </td>
                      <td className="py-2 text-xs text-muted">{r.instanceType ?? "—"}</td>
                      <td className="py-2 text-xs text-muted">{r.region}</td>
                      <td className="py-2 text-right tabular-nums">{r.hourly ? formatUsdPerHour(r.hourly) : "—"}</td>
                      <td className="py-2 text-right tabular-nums">
                        {r.hourly ? formatUsd(r.hourly * HOURS_PER_MONTH) : "—"}
                      </td>
                      <td className="py-2 text-xs text-muted"><PriceSourceBadge source={r.source} fetchedAt={r.fetchedAt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {idleCandidates.length > 0 && (
        <Card className="surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
              Cost-saving candidates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted">
              Larger running VMs that may be candidates for stop / right-size if traffic is low. Pair with the per-instance metrics
              tab for a real verdict.
            </p>
            <div className="grid gap-2">
              {idleCandidates.map((r) => (
                <Link
                  key={r.id}
                  href={`/instances/${encodeURIComponent(r.id)}`}
                  className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2 hover:border-[var(--color-primary)]/40"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="info">{r.provider.toUpperCase()}</Badge>
                    <span className="text-sm">{r.name ?? r.id}</span>
                    <span className="text-xs text-muted">{r.instanceType}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{r.hourly ? formatUsdPerHour(r.hourly) : "—"}</div>
                    <div className="text-xs text-muted">
                      {r.hourly ? `${formatUsd(r.hourly * HOURS_PER_MONTH)}/mo` : ""}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <SpotSavingsCard rows={running} />

      <Suspense fallback={null}>
        <CostTrendCard />
      </Suspense>
      <Suspense fallback={null}>
        <CostForecastCard />
      </Suspense>
      <Suspense fallback={null}>
        <CostAnomaliesCard />
      </Suspense>
      <div className="flex justify-end">
        <Link
          href="/costs/projections"
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-white/5"
        >
          <TrendingUp className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          See 30 / 60 / 90 day projections \u2192
        </Link>
      </div>
      <Suspense fallback={null}>
        <CostByTagCard />
      </Suspense>
      <TagBudgetsCard />

      <Suspense fallback={null}>
        <IdleScanSection />
      </Suspense>
    </div>
  );
}

function SpotSavingsCard({ rows }: { rows: InstanceCost[] }) {
  const enriched = rows
    .map((r) => ({ row: r, savings: spotSavings(r.provider, r.hourly) }))
    .filter((e) => e.savings.spotEligible && e.savings.potentialMonthlySavingsUsd >= 5)
    .sort((a, b) => b.savings.potentialMonthlySavingsUsd - a.savings.potentialMonthlySavingsUsd)
    .slice(0, 8);
  if (enriched.length === 0) return null;
  const total = enriched.reduce((s, e) => s + e.savings.potentialMonthlySavingsUsd, 0);
  return (
    <Card className="surface">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4 text-[var(--color-warning)]" />
          Spot / preemptible coverage
          <Badge variant="info" className="ml-2 text-[10px]">
            up to {formatUsd(total)}/mo
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted">
          Switching these workloads to spot/preemptible could save roughly the amount shown. Spot
          discounts vary by region and demand; figures are conservative estimates.
        </p>
        <div className="grid gap-2">
          {enriched.map(({ row, savings }) => (
            <Link
              key={row.id}
              href={`/instances/${encodeURIComponent(row.id)}`}
              className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2 hover:border-[var(--color-primary)]/40"
            >
              <div className="flex items-center gap-3">
                <Badge variant="info">{row.provider.toUpperCase()}</Badge>
                <span className="text-sm">{row.name ?? row.id}</span>
                <span className="text-xs text-muted">{row.instanceType}</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-[var(--color-success)]">
                  -{formatUsd(savings.potentialMonthlySavingsUsd)}/mo
                </div>
                <div className="text-[10px] text-muted">
                  ~{Math.round(savings.discountFactor * 100)}% off on-demand
                </div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

function PriceSourceBadge({ source, fetchedAt }: { source: string | null; fetchedAt: Date | null }) {
  if (!source) return <span>—</span>;
  const ageMs = fetchedAt ? Date.now() - fetchedAt.getTime() : null;
  const isStaticTable = source === "static";
  const isStaleLive = !isStaticTable && ageMs !== null && ageMs > STALE_AFTER_MS;
  if (isStaticTable) {
    return (
      <Badge variant="warning" className="text-[10px]" title="Curated static price — may not reflect live regional rates">
        static
      </Badge>
    );
  }
  if (isStaleLive) {
    const hours = Math.round((ageMs ?? 0) / 3_600_000);
    return (
      <Badge variant="warning" className="text-[10px]" title={`Cached ${hours}h ago — refresh on next sync`}>
        {source} · {hours}h old
      </Badge>
    );
  }
  return <span>{source}</span>;
}
