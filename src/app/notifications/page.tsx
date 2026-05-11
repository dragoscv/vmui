import { Bell, CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { listNotifications } from "@/lib/notifications";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { NotificationRow } from "@/lib/db/schema";
import { DismissAllButton } from "@/components/nav/notifications-page-actions";

export const dynamic = "force-dynamic";

const ICON: Record<NotificationRow["severity"], typeof Bell> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

const SEV_VARIANT: Record<NotificationRow["severity"], "info" | "success" | "warning" | "danger" | "muted"> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "danger",
};

export default async function NotificationsPage() {
  const rows = await listNotifications({ includeDismissed: true, limit: 200 });
  const undismissed = rows.filter((r) => !r.dismissedAt);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-[var(--shadow-glow)]">
          <Bell className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted">
            Curated, dismissible inbox derived from system events. The full record lives in{" "}
            <Link href="/activity" className="underline">Activity</Link>.
          </p>
        </div>
        {undismissed.length > 0 && <DismissAllButton />}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted">
            No notifications yet. Things you'd want to know — failed schedules, budget breaches, compliance findings —
            will appear here.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const Icon = ICON[r.severity];
            return (
              <li
                key={r.id}
                className={`flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 ${
                  r.dismissedAt ? "opacity-50" : ""
                }`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">{r.title}</div>
                    <Badge variant={SEV_VARIANT[r.severity]}>{r.severity}</Badge>
                    <Badge variant="muted">{r.category}</Badge>
                  </div>
                  {r.body && <div className="mt-1 text-xs text-muted">{r.body}</div>}
                  <div className="mt-1 text-[11px] text-muted">
                    {new Date(r.createdAt).toLocaleString()}
                    {r.dismissedAt ? ` · dismissed` : r.seenAt ? ` · seen` : " · new"}
                    {r.href ? (
                      <>
                        {" · "}
                        <Link href={r.href} className="underline">open</Link>
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
