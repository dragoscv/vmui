import "server-only";
import Link from "next/link";
import { TrendingUp, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { computeProjections } from "@/server/queries/projections";
import { formatUsd } from "@/lib/utils";
import { ProjectionChart } from "@/components/costs/projection-chart";

export const dynamic = "force-dynamic";

export default async function ProjectionsPage() {
  const p = await computeProjections(30);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <TrendingUp className="h-6 w-6 text-[var(--color-primary)]" />
            Cost projections
          </h1>
          <p className="text-sm text-muted">
            30 / 60 / 90 day projections from the last 30 days of sync history. Confidence widens with horizon.
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/costs">
            <ArrowLeft className="h-4 w-4" /> Back to costs
          </Link>
        </Button>
      </div>

      {!p ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted">
            Not enough sync history to project yet. Run a few syncs over the next few hours.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {p.bands.map((b) => (
              <Card key={b.daysAhead} className="surface">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    In <span className="text-[var(--color-primary)]">{b.daysAhead}</span> days
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold tracking-tight">{formatUsd(b.monthlyUsd)}/mo</div>
                  <div className="mt-1 text-xs text-muted">
                    {formatUsd(b.monthlyLo)} – {formatUsd(b.monthlyHi)} <span className="opacity-60">(95% CI)</span>
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-muted">
                    {formatUsd(b.hourlyUsd)}/hr
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="surface">
            <CardHeader>
              <CardTitle className="text-base">Hourly burn trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectionChart
                history={p.history}
                bands={p.bands}
                sigma={p.sigma}
                slopeUsdPerDay={p.slopeUsdPerDay}
                currentHourlyUsd={p.currentHourlyUsd}
              />
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
                <span>
                  Slope: <strong className="text-fg">{formatUsd(p.slopeUsdPerDay)}</strong>/day
                </span>
                <span>
                  Points used: <strong className="text-fg">{p.pointsUsed}</strong>
                </span>
                <span>
                  Residual \u03c3: <strong className="text-fg">{formatUsd(p.sigma)}</strong>/hr
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
