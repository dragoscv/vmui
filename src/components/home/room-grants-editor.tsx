"use client";

import type { RoomGrants, RoomLevel } from "@/lib/home/access-model";
import { ROOMS, type RoomId } from "@/lib/home/catalog";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

type Level = RoomLevel | "none";
const LEVELS: Level[] = ["none", "view", "control"];

/** One row per room, three-state segmented control (none / view / control). */
export function RoomGrantsEditor({ value, onChange, disabled = false }: { value: RoomGrants; onChange: (next: RoomGrants) => void; disabled?: boolean }) {
  const rooms = useTranslations("home.rooms");
  const t = useTranslations("family.level");

  const set = (room: RoomId, level: Level) => {
    const next: RoomGrants = { ...value };
    if (level === "none") delete next[room];
    else next[room] = level;
    onChange(next);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      {ROOMS.map((room) => {
        const current: Level = value[room.id] ?? "none";
        return (
          <div key={room.id} className="contents">
            <span className="min-w-0 truncate text-sm">{rooms(room.id)}</span>
            <div role="group" aria-label={rooms(room.id)} className="inline-flex shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
              {LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={current === level}
                  disabled={disabled}
                  onClick={() => set(room.id, level)}
                  className={cn(
                    "h-8 px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color-mix(in_oklch,var(--color-primary)_55%,transparent)] disabled:cursor-not-allowed disabled:opacity-50",
                    "border-l border-[var(--color-border)] first:border-l-0",
                    current === level ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : "bg-[var(--color-surface)] text-muted hover:text-[var(--color-fg)]",
                  )}
                >
                  {t(level)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
