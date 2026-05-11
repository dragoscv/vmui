import "server-only";
import Link from "next/link";
import { ArrowLeft, History, Plus, Minus, RefreshCcw } from "lucide-react";
import { db } from "@/lib/db";
import { syncHistory, cloudAccounts } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface SyncDetails {
  added?: string[];
  removed?: string[];
  stateChanged?: Array<{ id: string; from: string; to: string }>;
}

function parseDetails(json: string | null): SyncDetails {
  if (!json) return {};
  try {
    return JSON.parse(json) as SyncDetails;
  } catch {
    return {};
  }
}

export default async function SyncHistoryPage() {
  const [rows, accounts] = await Promise.all([
    db.select().from(syncHistory).orderBy(desc(syncHistory.capturedAt)).limit(200),
    db.select().from(cloudAccounts),
  ]);
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <History className="h-6 w-6 text-[var(--color-primary)]" />
            Sync history
          </h1>
          <p className="text-sm text-muted">
            Per-region sync events where instances were added, removed, or changed state. Last 200 events.
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/activity">
            <ArrowLeft className="h-4 w-4" /> Activity
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted">
            No non-trivial sync events yet. Differences will appear here as VMs come and go.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const acc = accountMap.get(r.accountId);
            const d = parseDetails(r.detailsJson);
            return (
              <li key={r.id}>
                <Card className="surface">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="info" className="text-[10px]">
                        {acc?.provider ?? "?"}
                      </Badge>
                      <span className="font-mono">{r.region}</span>
                      <span className="text-muted">{acc?.name ?? r.accountId}</span>
                      <span className="ml-auto font-mono text-[11px] text-muted">
                        {formatRelative(r.capturedAt)} \u00b7 {r.durationMs}ms
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap gap-3 text-xs">
                      {r.added > 0 && (
                        <span className="flex items-center gap-1 text-[var(--color-success)]">
                          <Plus className="h-3 w-3" /> {r.added} added
                        </span>
                      )}
                      {r.removed > 0 && (
                        <span className="flex items-center gap-1 text-[var(--color-danger)]">
                          <Minus className="h-3 w-3" /> {r.removed} removed
                        </span>
                      )}
                      {r.stateChanged > 0 && (
                        <span className="flex items-center gap-1 text-[var(--color-warning)]">
                          <RefreshCcw className="h-3 w-3" /> {r.stateChanged} state change
                          {r.stateChanged === 1 ? "" : "s"}
                        </span>
                      )}
                      <span className="ml-auto text-muted">total {r.total}</span>
                    </div>
                    {(d.added?.length || d.removed?.length || d.stateChanged?.length) && (
                      <div className="grid gap-2 text-[11px] font-mono text-muted sm:grid-cols-3">
                        {d.added && d.added.length > 0 && (
                          <div>
                            <div className="mb-0.5 uppercase tracking-wide text-[var(--color-success)]">added</div>
                            <ul className="space-y-0.5">
                              {d.added.slice(0, 6).map((id) => (
                                <li key={id} className="truncate" title={id}>
                                  + {id}
                                </li>
                              ))}
                              {d.added.length > 6 && (
                                <li className="opacity-70">+ {d.added.length - 6} more</li>
                              )}
                            </ul>
                          </div>
                        )}
                        {d.removed && d.removed.length > 0 && (
                          <div>
                            <div className="mb-0.5 uppercase tracking-wide text-[var(--color-danger)]">removed</div>
                            <ul className="space-y-0.5">
                              {d.removed.slice(0, 6).map((id) => (
                                <li key={id} className="truncate" title={id}>
                                  - {id}
                                </li>
                              ))}
                              {d.removed.length > 6 && (
                                <li className="opacity-70">+ {d.removed.length - 6} more</li>
                              )}
                            </ul>
                          </div>
                        )}
                        {d.stateChanged && d.stateChanged.length > 0 && (
                          <div>
                            <div className="mb-0.5 uppercase tracking-wide text-[var(--color-warning)]">state</div>
                            <ul className="space-y-0.5">
                              {d.stateChanged.slice(0, 6).map((s) => (
                                <li key={s.id} className="truncate" title={s.id}>
                                  {s.id}: {s.from} \u2192 {s.to}
                                </li>
                              ))}
                              {d.stateChanged.length > 6 && (
                                <li className="opacity-70">
                                  + {d.stateChanged.length - 6} more
                                </li>
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
