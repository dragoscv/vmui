import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tag as TagIcon, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { TagGovernanceSummary } from "@/server/queries/tag-governance";

export function TagGovernancePanel({ data }: { data: TagGovernanceSummary }) {
  const taggedPct =
    data.totalInstances === 0 ? 100 : Math.round((data.taggedInstances / data.totalInstances) * 100);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted">Instances</div>
            <div className="text-2xl font-semibold tabular-nums">{data.totalInstances}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted">Tagged</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{data.taggedInstances}</span>
              <span className="text-xs text-muted">({taggedPct}%)</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted">Untagged</div>
            <div
              className={
                data.untaggedInstances > 0
                  ? "text-2xl font-semibold tabular-nums text-[var(--color-warning)]"
                  : "text-2xl font-semibold tabular-nums text-[var(--color-success)]"
              }
            >
              {data.untaggedInstances}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TagIcon className="h-4 w-4" /> Top tag keys
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.perKey.length === 0 ? (
              <p className="text-xs text-muted">No tags applied yet.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {data.perKey.slice(0, 10).map((k) => (
                  <li key={k.key} className="flex items-center justify-between gap-2">
                    <code className="truncate font-mono">{k.key}</code>
                    <span className="text-muted">
                      {k.instances} instance{k.instances === 1 ? "" : "s"} · {k.uniqueValues} value{k.uniqueValues === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Required-tag coverage</CardTitle>
          </CardHeader>
          <CardContent>
            {data.accountCoverage.length === 0 ? (
              <p className="text-xs text-muted">No accounts.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {data.accountCoverage.map((a) => {
                  const noReq = a.requiredKeys.length === 0;
                  const Icon = a.coveragePct >= 100 ? CheckCircle2 : AlertTriangle;
                  const color =
                    a.coveragePct >= 100
                      ? "text-[var(--color-success)]"
                      : a.coveragePct >= 50
                        ? "text-[var(--color-warning)]"
                        : "text-[var(--color-danger)]";
                  return (
                    <li key={a.accountId} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          <span className="font-medium">{a.accountName}</span>{" "}
                          <Badge variant="muted">{a.provider}</Badge>
                        </span>
                        <span className={`inline-flex items-center gap-1 font-mono ${color}`}>
                          <Icon className="h-3 w-3" /> {a.coveragePct}%
                        </span>
                      </div>
                      {noReq ? (
                        <div className="text-[10px] text-muted">No required tags configured.</div>
                      ) : (
                        <div className="text-[10px] text-muted">
                          {a.fullyCompliant}/{a.totalInstances} fully tagged · requires{" "}
                          {a.requiredKeys.map((k) => (
                            <code key={k} className="ml-1 font-mono">{k}</code>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
