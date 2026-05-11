import { Sparkles, ArrowDownRight, Power, Gauge } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listCostRecommendations, totalProjectedMonthlySavings } from "@/server/queries/cost-recommendations";
import { formatUsd } from "@/lib/utils";
import { RecomputeButton } from "@/components/costs/recompute-button";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, { label: string; tone: "info" | "warning" | "muted" }> = {
  rightsize: { label: "Rightsize", tone: "info" },
  idle: { label: "Idle", tone: "warning" },
  "stop-after-hours": { label: "Stop after hours", tone: "muted" },
  "spot-eligible": { label: "Spot eligible", tone: "info" },
};

export default async function CostRecommendationsPage() {
  const [rows, total] = await Promise.all([
    listCostRecommendations(),
    totalProjectedMonthlySavings(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="h-6 w-6 text-[var(--color-primary)]" />
            Cost recommendations
          </h1>
          <p className="text-sm text-muted">
            AWS CloudWatch over the last 14 days. Idle = p95 CPU &lt; 3%, Rightsize = p95 &lt; 20% with a smaller type in the same family.
          </p>
        </div>
        <RecomputeButton />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="surface">
          <CardContent className="py-4">
            <div className="text-xs uppercase tracking-wide text-muted">Open recs</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{rows.length}</div>
          </CardContent>
        </Card>
        <Card className="surface">
          <CardContent className="py-4">
            <div className="text-xs uppercase tracking-wide text-muted">Projected savings / mo</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-success)]">
              {formatUsd(total)}
            </div>
          </CardContent>
        </Card>
        <Card className="surface">
          <CardContent className="py-4">
            <div className="text-xs uppercase tracking-wide text-muted">Idle candidates</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {rows.filter((r) => r.kind === "idle").length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="surface">
        <CardHeader>
          <CardTitle className="text-base">Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted">
              No recommendations yet. Click <span className="font-medium">Recompute</span> after instances have been running for at least a day.
            </p>
          ) : (
            <div className="grid gap-2">
              {rows.map((r) => {
                const kindMeta = KIND_LABEL[r.kind] ?? { label: r.kind, tone: "muted" as const };
                const Icon = r.kind === "idle" ? Power : r.kind === "rightsize" ? ArrowDownRight : Gauge;
                return (
                  <Link
                    key={r.id}
                    href={`/instances/${encodeURIComponent(r.instanceId)}`}
                    className="group flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2 transition hover:border-[color-mix(in_oklch,var(--color-primary)_45%,var(--color-border))]"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-[var(--color-primary)]" />
                        <Badge variant={kindMeta.tone}>{kindMeta.label}</Badge>
                        <span className="text-sm font-medium">
                          {r.instanceName ?? r.instanceId}
                        </span>
                        <span className="text-xs text-muted">
                          {r.provider.toUpperCase()} · {r.region} · {r.instanceType ?? "?"}
                        </span>
                      </div>
                      <div className="text-xs text-muted">{r.summary}</div>
                    </div>
                    <div className="text-right">
                      {r.estMonthlySavingsUsd != null && (
                        <div className="text-sm font-semibold tabular-nums text-[var(--color-success)]">
                          +{formatUsd(r.estMonthlySavingsUsd)}/mo
                        </div>
                      )}
                      {r.observedCpuP95 != null && (
                        <div className="text-[11px] text-muted">
                          p95 CPU {r.observedCpuP95.toFixed(1)}% over {Math.round((r.lookbackHours ?? 0) / 24)}d
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
