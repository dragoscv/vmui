import { CheckCircle2, XCircle } from "lucide-react";
import { listAuditLog } from "@/server/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const log = await listAuditLog(100);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted">Recent operations performed by vmui.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Last {log.length} events</CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <div className="py-8 text-center text-muted">No activity yet.</div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {log.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                  {e.status === "ok" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-success)]" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-[var(--color-danger)]" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{e.action}</div>
                    {e.message && <div className="truncate text-xs text-muted">{e.message}</div>}
                  </div>
                  {e.target && <code className="hidden font-mono text-[11px] text-muted sm:inline">{e.target}</code>}
                  <span className="shrink-0 text-xs text-muted">{formatRelative(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
