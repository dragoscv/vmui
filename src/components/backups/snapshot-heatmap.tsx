"use client";

import { useMemo } from "react";
import type { SnapshotEvent } from "@/server/queries/snapshots";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 26;

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** GitHub-style 26-week heatmap. Columns = weeks, rows = weekdays. */
export function SnapshotHeatmap({ events }: { events: SnapshotEvent[] }) {
  const { grid, max, monthLabels } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) {
      const k = dayKey(e.capturedAt);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayDow = today.getUTCDay();
    // align so the rightmost column ends on today; columns step back by 7 days.
    const lastSunday = new Date(today.getTime() - todayDow * DAY_MS);
    const start = new Date(lastSunday.getTime() - (WEEKS - 1) * 7 * DAY_MS);

    const grid: { date: Date; key: string; count: number }[][] = [];
    const monthLabels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const col: { date: Date; key: string; count: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start.getTime() + (w * 7 + d) * DAY_MS);
        const key = dayKey(date.getTime());
        col.push({ date, key, count: counts.get(key) ?? 0 });
      }
      const m = col[0]?.date.getUTCMonth() ?? 0;
      if (m !== lastMonth) {
        monthLabels.push({
          col: w,
          label: col[0]!.date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
        });
        lastMonth = m;
      }
      grid.push(col);
    }
    let max = 0;
    for (const v of counts.values()) if (v > max) max = v;
    return { grid, max, monthLabels };
  }, [events]);

  const intensity = (count: number) => {
    if (count === 0 || max === 0) return 0;
    const r = count / max;
    if (r >= 0.85) return 4;
    if (r >= 0.55) return 3;
    if (r >= 0.25) return 2;
    return 1;
  };
  const colorFor = (level: number) =>
    [
      "color-mix(in oklch, var(--color-surface-muted) 70%, transparent)",
      "color-mix(in oklch, var(--color-primary) 22%, transparent)",
      "color-mix(in oklch, var(--color-primary) 45%, transparent)",
      "color-mix(in oklch, var(--color-primary) 70%, transparent)",
      "var(--color-primary)",
    ][level];

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        <div className="ml-7 mb-1 grid" style={{ gridTemplateColumns: `repeat(${WEEKS}, 14px)`, gap: "2px" }}>
          {monthLabels.map((m) => (
            <div
              key={m.col}
              className="text-[10px] text-muted"
              style={{ gridColumnStart: m.col + 1 }}
            >
              {m.label}
            </div>
          ))}
        </div>
        <div className="flex">
          <div className="mr-1 grid grid-rows-7 gap-[2px] text-[9px] text-muted" style={{ height: "14px * 7" }}>
            {["", "M", "", "W", "", "F", ""].map((l, i) => (
              <div key={i} className="h-[14px] leading-[14px]">
                {l}
              </div>
            ))}
          </div>
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${WEEKS}, 14px)`, gap: "2px" }}
          >
            {grid.map((col, w) => (
              <div key={w} className="grid grid-rows-7 gap-[2px]">
                {col.map((cell) => {
                  const level = intensity(cell.count);
                  return (
                    <div
                      key={cell.key}
                      title={`${cell.key} — ${cell.count} snapshot${cell.count === 1 ? "" : "s"}`}
                      className="h-[14px] w-[14px] rounded-[3px] border border-black/5 transition-transform hover:scale-125"
                      style={{ background: colorFor(level) }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-muted">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <div
              key={l}
              className="h-[10px] w-[10px] rounded-[2px] border border-black/5"
              style={{ background: colorFor(l) }}
            />
          ))}
          <span>More · max {max}/day</span>
        </div>
      </div>
    </div>
  );
}
