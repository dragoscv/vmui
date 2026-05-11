"use client";

import { useMemo } from "react";
import type { SnapshotEvent } from "@/server/queries/snapshots";
import { HardDrive } from "lucide-react";

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function formatBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = n / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

const PROVIDER_COLOR: Record<string, string> = {
  aws: "oklch(78% 0.16 65)",
  azure: "oklch(70% 0.18 240)",
  gcp: "oklch(75% 0.14 145)",
  digitalocean: "oklch(70% 0.18 245)",
  hetzner: "oklch(70% 0.20 25)",
  scaleway: "oklch(72% 0.18 295)",
  "local-kvm": "oklch(70% 0.05 250)",
};

export function SnapshotTimeline({ events }: { events: SnapshotEvent[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, SnapshotEvent[]>();
    for (const e of events) {
      const d = new Date(e.capturedAt);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const arr = map.get(k);
      if (arr) arr.push(e);
      else map.set(k, [e]);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="grid place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] py-12 text-sm text-muted">
        No snapshots captured yet. Trigger one from an instance to see it here.
      </div>
    );
  }

  return (
    <div className="relative pl-6">
      <div className="absolute bottom-0 left-2 top-0 w-px bg-[var(--color-border)]" />
      <div className="space-y-6">
        {grouped.map(([dayKey, items]) => (
          <div key={dayKey}>
            <div className="relative mb-2 flex items-center gap-3">
              <div className="absolute -left-[18px] h-2.5 w-2.5 rounded-full bg-[var(--color-primary)] ring-4 ring-[var(--color-surface)]" />
              <h3 className="text-sm font-semibold">
                {new Date(items[0]!.capturedAt).toLocaleDateString("en-US", {
                  weekday: "short",
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </h3>
              <span className="text-[11px] text-muted">{items.length} snapshot{items.length === 1 ? "" : "s"}</span>
            </div>
            <div className="space-y-2">
              {items.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs"
                >
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{
                      background: `color-mix(in oklch, ${PROVIDER_COLOR[e.provider] ?? "var(--color-primary)"} 22%, transparent)`,
                      color: PROVIDER_COLOR[e.provider] ?? "var(--color-primary)",
                    }}
                  >
                    {e.provider}
                  </span>
                  <HardDrive className="h-3.5 w-3.5 text-muted" />
                  <div className="min-w-0 flex-1 truncate font-medium">{e.name ?? e.externalId}</div>
                  <span className="text-muted">{e.region}</span>
                  <span className="text-muted">{formatBytes(e.sizeBytes)}</span>
                  {e.status && (
                    <span className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[10px] text-muted">
                      {e.status}
                    </span>
                  )}
                  <span className="text-muted">{relativeTime(e.capturedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
