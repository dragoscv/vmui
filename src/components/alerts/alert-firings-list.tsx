import type { AlertFiringRow } from "@/lib/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  firings: AlertFiringRow[];
}

function relative(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AlertFiringsList({ firings }: Props) {
  if (firings.length === 0) {
    return (
      <Card>
        <CardContent className="grid place-items-center py-8 text-xs text-muted">
          No firings yet. Rules become active after their first threshold breach.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-[var(--color-border)]">
          {firings.map((f) => {
            const deliveries = (() => {
              try {
                return JSON.parse(f.deliveryJson ?? "[]") as { channelName: string; ok: boolean; error?: string }[];
              } catch {
                return [] as { channelName: string; ok: boolean; error?: string }[];
              }
            })();
            const Icon = f.status === "resolved" ? CheckCircle2 : AlertTriangle;
            const color = f.status === "resolved" ? "text-emerald-500" : "text-red-500";
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
                <Icon className={`h-3.5 w-3.5 ${color}`} />
                <span className="font-mono">{f.metric}</span>
                <span className="text-muted">
                  {f.value} {f.status === "firing" ? "exceeds" : "is back below"} {f.threshold}
                </span>
                {f.instanceId && <span className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-[10px]">{f.instanceId}</span>}
                <div className="flex-1" />
                <div className="flex items-center gap-1">
                  {deliveries.map((d, i) => (
                    <span
                      key={i}
                      title={d.error ?? "delivered"}
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${d.ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-red-500/15 text-red-700 dark:text-red-300"}`}
                    >
                      {d.channelName}
                    </span>
                  ))}
                </div>
                <span className="text-muted">{relative(f.firedAt.getTime())}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
