"use client";

import { Button } from "@/components/ui";
import type { SnapshotEvent } from "@/server/queries/snapshots";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

function ymKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function SnapshotMonth({ events }: { events: SnapshotEvent[] }) {
  const t = useTranslations("ops.backups.month");
  const format = useFormatter();
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

  // 2024-01-07 is a Sunday; the week header follows the locale's short names.
  const weekdays = Array.from({ length: 7 }, (_, i) => format.dateTime(new Date(2024, 0, 7 + i), { weekday: "short" }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{format.dateTime(cursor, { month: "long", year: "numeric" })}</div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-8 sm:size-8" onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label={t("previousMonth")}>
            <ChevronLeft className="size-3.5" aria-hidden />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>
            {t("today")}
          </Button>
          <Button variant="outline" size="icon" className="size-8 sm:size-8" onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label={t("nextMonth")}>
            <ChevronRight className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[10px] text-fg-muted">
        {weekdays.map((d) => (
          <div key={d} className="px-1 py-0.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          const isToday = cell.day !== null && year === today.getFullYear() && month === today.getMonth() && cell.day === today.getDate();
          return (
            <div
              key={i}
              title={cell.key ? t("cellTitle", { date: cell.key, count: cell.count }) : undefined}
              className={`min-h-[64px] rounded-[var(--radius-md)] border p-1.5 text-xs transition ${
                cell.day === null
                  ? "border-transparent"
                  : isToday
                    ? "border-primary bg-[color-mix(in_oklch,var(--color-primary)_8%,transparent)]"
                    : "border-border hover:bg-surface-muted"
              }`}
            >
              {cell.day !== null && (
                <>
                  <div className="text-[10px] text-fg-muted">{cell.day}</div>
                  {cell.count > 0 && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      {cell.count}
                    </div>
                  )}
                  {cell.events.slice(0, 2).map((e) => (
                    <div key={e.id} className="mt-0.5 truncate text-[10px] text-fg-muted">
                      {e.name ?? e.externalId}
                    </div>
                  ))}
                  {cell.events.length > 2 && <div className="mt-0.5 text-[10px] text-fg-muted">{t("more", { count: cell.events.length - 2 })}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
