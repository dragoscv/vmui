"use client";

import { useMemo, useState } from "react";
import type { SnapshotEvent } from "@/server/queries/snapshots";
import { ChevronLeft, ChevronRight } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function SnapshotMonth({ events }: { events: SnapshotEvent[] }) {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const eventsByDay = useMemo(() => {
    const m = new Map<string, SnapshotEvent[]>();
    for (const e of events) {
      const d = new Date(e.capturedAt);
      const k = ymKey(d.getFullYear(), d.getMonth(), d.getDate());
      const arr = m.get(k);
      if (arr) arr.push(e);
      else m.set(k, [e]);
    }
    return m;
  }, [events]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: { day: number | null; key: string | null; count: number; events: SnapshotEvent[] }[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ day: null, key: null, count: 0, events: [] });
  for (let d = 1; d <= daysInMonth; d++) {
    const k = ymKey(year, month, d);
    const list = eventsByDay.get(k) ?? [];
    cells.push({ day: d, key: k, count: list.length, events: list });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, key: null, count: 0, events: [] });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">
          {cursor.toLocaleString("en-US", { month: "long", year: "numeric" })}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:bg-[var(--color-surface-muted)]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[10px] text-muted">
        {DAYS.map((d) => (
          <div key={d} className="px-1 py-0.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          const isToday =
            cell.day &&
            year === today.getFullYear() &&
            month === today.getMonth() &&
            cell.day === today.getDate();
          return (
            <div
              key={i}
              title={cell.key ? `${cell.key} — ${cell.count} snapshot${cell.count === 1 ? "" : "s"}` : ""}
              className={`min-h-[64px] rounded-[var(--radius-md)] border p-1.5 text-xs transition ${
                cell.day === null
                  ? "border-transparent"
                  : isToday
                  ? "border-[var(--color-primary)] bg-[color-mix(in_oklch,var(--color-primary)_8%,transparent)]"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {cell.day !== null && (
                <>
                  <div className="text-[10px] text-muted">{cell.day}</div>
                  {cell.count > 0 && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
                      {cell.count}
                    </div>
                  )}
                  {cell.events.slice(0, 2).map((e) => (
                    <div key={e.id} className="mt-0.5 truncate text-[10px] text-muted">
                      {e.name ?? e.externalId}
                    </div>
                  ))}
                  {cell.events.length > 2 && (
                    <div className="mt-0.5 text-[10px] text-muted">+{cell.events.length - 2} more</div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
