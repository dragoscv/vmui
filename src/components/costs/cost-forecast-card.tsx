import "server-only";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeCostForecast } from "@/server/queries/forecast";
import { formatUsd, HOURS_PER_MONTH } from "@/lib/utils";

export async function CostForecastCard() {
  const f = await computeCostForecast();
  if (!f) {
    return (
      <Card className="surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-[var(--color-primary)]" />
            7-day cost forecast
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted">
          Not enough history yet. The forecast appears after ~4 sync snapshots — run syncs over a few hours/days.
        </CardContent>
      </Card>
    );
  }
  const trendingUp = f.slopeUsdPerDay > 0.01;
  const trendingDown = f.slopeUsdPerDay < -0.01;
  const Icon = trendingUp ? TrendingUp : trendingDown ? TrendingDown : TrendingUp;
  const color = trendingUp ? "var(--color-warning)" : trendingDown ? "var(--color-success)" : "var(--color-primary)";

  return (
    <Card className="surface">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" style={{ color }} />
          7-day cost forecast
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-3">
        <div>
          <div className="text-2xl font-semibold tracking-tight">{formatUsd(f.forecastHourlyUsd)}/hr</div>
          <div className="text-xs text-muted">projected hourly burn 7 days from now</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tracking-tight">{formatUsd(f.forecastHourlyUsd * HOURS_PER_MONTH)}</div>
          <div className="text-xs text-muted">projected monthly run-rate</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tracking-tight" style={{ color }}>
            {f.slopeUsdPerDay >= 0 ? "+" : ""}
            {formatUsd(f.slopeUsdPerDay)}/day
          </div>
          <div className="text-xs text-muted">trend over last {f.rangeDays} days · {f.pointsUsed} samples</div>
        </div>
      </CardContent>
    </Card>
  );
}
