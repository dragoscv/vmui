import { detectCostAnomalies } from "@/lib/cost-anomaly";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AnomaliesPage() {
  const report = await detectCostAnomalies(30, 2.0);
  const { points, mean, stdDev, threshold, anomalies } = report;

  const max = Math.max(1, ...points.map((p) => p.usd));
  const w = 900, h = 200;
  const xStep = points.length > 1 ? w / (points.length - 1) : w;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Cost anomalies</h1>
        <p className="text-sm text-muted">Z-score detection on daily fleet spend. Days exceeding ±{threshold}σ are flagged.</p>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Mean daily" value={`$${mean.toFixed(2)}`} />
        <Stat label="Std dev" value={`$${stdDev.toFixed(2)}`} />
        <Stat label="Window" value={`${points.length} days`} />
        <Stat label="Anomalies" value={String(anomalies.length)} />
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
        {points.length < 3 ? (
          <p className="text-center text-xs text-muted">Need at least 3 days of cost snapshots to compute anomalies.</p>
        ) : (
          <svg viewBox={`0 0 ${w} ${h}`} className="h-48 w-full" preserveAspectRatio="none">
            <line x1={0} y1={h - (mean / max) * (h - 10) - 4} x2={w} y2={h - (mean / max) * (h - 10) - 4} stroke="var(--color-border)" strokeDasharray="3 3" />
            <polyline
              points={points.map((p, i) => `${(i * xStep).toFixed(1)},${(h - (p.usd / max) * (h - 10) - 4).toFixed(1)}`).join(" ")}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={1.5}
            />
            {points.map((p, i) => p.isAnomaly && (
              <circle key={p.day} cx={i * xStep} cy={h - (p.usd / max) * (h - 10) - 4} r={4} fill="rgb(244 63 94)" />
            ))}
          </svg>
        )}
      </div>
      <section className="rounded-lg border border-[var(--color-border)]">
        <header className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-medium text-muted">Recent anomalies</header>
        {anomalies.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> No anomalies detected.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] text-sm">
            {anomalies.slice().reverse().map((a) => (
              <li key={a.day} className="flex items-center gap-3 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-300" />
                <span className="font-mono text-xs">{a.day}</span>
                <span className="ml-auto">${a.usd.toFixed(2)}</span>
                <span className={`w-16 text-right font-mono text-xs ${a.zScore > 0 ? "text-rose-300" : "text-sky-300"}`}>z={a.zScore.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg">{value}</div>
    </div>
  );
}
