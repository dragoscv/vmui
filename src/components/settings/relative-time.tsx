"use client";

import { useFormatter, useNow } from "next-intl";

/** `format.relativeTime` needs an explicit `now` or it warns and can mismatch on hydration; one ticking clock per table. */
export function RelativeTime({ date, className }: { date: Date | string | number; className?: string }) {
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const d = new Date(date);
  return (
    <time dateTime={d.toISOString()} className={className} title={format.dateTime(d, { dateStyle: "medium", timeStyle: "short" })}>
      {format.relativeTime(d, now)}
    </time>
  );
}
