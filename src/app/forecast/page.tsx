import { buildCostForecast } from "@/lib/cost-forecast";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ForecastPage() {
  const { points, slopeUsdPerDay, r2 } = await buildCostForecast(30, 30);

  const max = Math.max(1, ...points.map((p) => Math.max(p.actualUsd ?? 0, p.projectedUsd ?? 0)));
  const w = 900, h = 220;
  const xStep = points.length > 1 ? w / (points.length - 1) : w;
  const xy = (v: number | null, i: number) => v == null ? null : `${(i * xStep).toFixed(1)},${(h - (v / max) * (h - 10) - 4).toFixed(1)}`;

  const actualPath = points.map((p, i) => xy(p.actualUsd, i)).filter(Boolean).join(" L");
  const projPath = points.map((p, i) => xy(p.projectedUsd, i)).filter(Boolean).join(" L");
  const splitIdx = points.findIndex((p) => p.actualUsd == null);

  const trend = slopeUsdPerDay > 0.5 ? "up" : slopeUsdPerDay < -0.5 ? "down" : "flat";
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-rose-300" : trend === "down" ? "text-emerald-300" : "text-muted";

  const monthlyAt30 = (points[points.length - 1]?.projectedUsd ?? 0) * 30;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Cost forecast</h1>
        <p className="text-sm text-muted">Linear regression on the last 30 days of fleet hourly burn projected 30 days forward.</p>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Slope" value={`$${slopeUsdPerDay.toFixed(2)} / day`} icon={<TrendIcon className={`h-4 w-4 ${trendColor}`} />} />
        <Stat label="R²" value={r2.toFixed(3)} />
        <Stat label="Day-30 daily" value={`$${(points[points.length - 1]?.projectedUsd ?? 0).toFixed(2)}`} />
        <Stat label="Day-30 monthly" value={`$${monthlyAt30.toFixed(0)}`} />
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
        {points.length === 0 ? (
          <p className="text-center text-xs text-muted">No history yet — sync your accounts to record cost snapshots.</p>
        ) : (
          <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full" preserveAspectRatio="none">
            {actualPath ? <path d={`M${actualPath}`} fill="none" stroke="var(--color-primary)" strokeWidth="2" /> : null}
            {projPath ? <path d={`M${projPath}`} fill="none" stroke="rgb(244 114 182)" strokeWidth="1.5" strokeDasharray="4,3" /> : null}
            {splitIdx > 0 ? <line x1={splitIdx * xStep} x2={splitIdx * xStep} y1="0" y2={h} stroke="var(--color-border)" /> : null}
          </svg>
        )}
        <div className="mt-2 flex justify-center gap-4 text-[10px] uppercase tracking-wide text-muted">
          <span><span className="mr-1 inline-block h-1.5 w-3 align-middle" style={{ background: "var(--color-primary)" }} /> actual</span>
          <span><span className="mr-1 inline-block h-1.5 w-3 align-middle" style={{ background: "rgb(244 114 182)" }} /> projected</span>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted">{label}{icon}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
