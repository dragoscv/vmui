import "server-only";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { detectCostAnomalies } from "@/server/queries/cost-anomalies";
import { formatUsdPerHour } from "@/lib/utils";

export async function CostAnomaliesCard() {
  const rows = await detectCostAnomalies();
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
          Cost anomalies
        </CardTitle>
        <p className="text-xs text-muted">
          Days where hourly spend deviates from the 7-day trailing average.
        </p>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map((a) => (
          <div
            key={`${a.accountId}:${a.day}`}
            className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] text-muted">{a.day}</div>
              <div className="truncate font-medium">{a.accountName}</div>
              <div className="text-[10px] text-muted uppercase">{a.provider}</div>
            </div>
            <div className="text-right">
              <div className="font-mono">{formatUsdPerHour(a.hourlyUsd)}</div>
              <div className="text-[10px] text-muted">
                vs avg {formatUsdPerHour(a.trailingAvgUsd)}
              </div>
            </div>
            <Badge
              variant={a.severity === "alert" ? "danger" : a.severity === "warn" ? "warning" : "info"}
            >
              {a.ratio.toFixed(1)}x
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
