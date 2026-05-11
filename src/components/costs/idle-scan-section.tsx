import "server-only";
import Link from "next/link";
import { ActivitySquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { findIdleAwsInstances } from "@/server/actions/idle-scan";

export async function IdleScanSection() {
  let hints: Awaited<ReturnType<typeof findIdleAwsInstances>> = [];
  try {
    hints = await findIdleAwsInstances();
  } catch {
    hints = [];
  }
  if (hints.length === 0) return null;
  return (
    <Card className="surface">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ActivitySquare className="h-4 w-4 text-[var(--color-warning)]" />
          Truly idle (CloudWatch · last 7 days)
          <Badge variant="warning" className="ml-2 text-[10px]">
            {hints.length} flagged
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted">
          AWS-only for now: instances with average CPU &lt; 5% over the last week.
          Click through to verify in the metrics tab before stopping.
        </p>
        <div className="grid gap-2">
          {hints.map((h) => (
            <Link
              key={h.instanceId}
              href={`/instances/${encodeURIComponent(h.instanceId)}`}
              className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2 hover:border-[var(--color-primary)]/40"
            >
              <div className="flex items-center gap-3">
                <Badge variant="info">AWS</Badge>
                <span className="text-sm">{h.name}</span>
                <span className="text-xs text-muted">{h.providerInstanceId}</span>
              </div>
              <div className="text-right text-sm tabular-nums text-muted">
                avg CPU {h.averageCpuPct.toFixed(1)}%
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
