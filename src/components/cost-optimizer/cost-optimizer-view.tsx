"use client";

import { useMemo, useState } from "react";
import { Coffee, ArrowDownToLine, PiggyBank, BedDouble } from "lucide-react";
import type { CostRecommendation, RecommendationKind } from "@/lib/cost-optimizer";

const KIND_ICON: Record<RecommendationKind, typeof Coffee> = {
  idle: BedDouble,
  "rightsize-down": ArrowDownToLine,
  "stop-and-snapshot": Coffee,
  "reserved-instance": PiggyBank,
};

const KIND_COLOR: Record<RecommendationKind, string> = {
  idle: "text-orange-300",
  "rightsize-down": "text-sky-300",
  "stop-and-snapshot": "text-amber-300",
  "reserved-instance": "text-emerald-300",
};

export function CostOptimizerView({ recommendations }: { recommendations: CostRecommendation[] }) {
  const [filter, setFilter] = useState<RecommendationKind | "all">("all");
  const filtered = useMemo(
    () => recommendations.filter((r) => filter === "all" || r.kind === filter),
    [recommendations, filter],
  );
  const total = useMemo(() => filtered.reduce((a, b) => a + b.monthlyUsd, 0), [filtered]);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Recommendations" value={`${recommendations.length}`} />
        <Stat label="Estimated monthly savings (shown)" value={`$${total.toFixed(0)}`} highlight />
        <Stat label="Estimated annual savings (shown)" value={`$${(total * 12).toFixed(0)}`} />
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {(["all", "idle", "rightsize-down", "stop-and-snapshot", "reserved-instance"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-md px-3 py-1 ${filter === k ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : "border border-[var(--color-border)] bg-[var(--color-surface)]"}`}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface-muted)] text-xs uppercase text-muted">
            <tr>
              <th className="px-2 py-2 text-left">Kind</th>
              <th className="px-2 py-2 text-left">Instance</th>
              <th className="px-2 py-2 text-left">Type</th>
              <th className="px-2 py-2 text-left">Reason</th>
              <th className="px-2 py-2 text-left">Suggestion</th>
              <th className="px-2 py-2 text-right">Monthly saving</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted">
                  No recommendations yet — collect more metric history (probe samples) to enable analysis.
                </td>
              </tr>
            ) : null}
            {filtered.map((r, i) => {
              const Icon = KIND_ICON[r.kind];
              return (
                <tr key={`${r.instanceId}-${r.kind}-${i}`} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-2">
                    <span className={`inline-flex items-center gap-1 text-xs ${KIND_COLOR[r.kind]}`}>
                      <Icon className="h-3.5 w-3.5" /> {r.kind}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-medium">{r.instanceName} <span className="text-xs text-muted">({r.provider}/{r.region})</span></td>
                  <td className="px-2 py-2 font-mono text-xs">{r.instanceType}</td>
                  <td className="px-2 py-2 text-xs text-muted">{r.reason}</td>
                  <td className="px-2 py-2 text-xs">{r.suggestion}</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-300">${r.monthlyUsd.toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${highlight ? "text-emerald-300" : ""}`}>{value}</div>
    </div>
  );
}
