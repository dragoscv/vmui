"use client";

import { RelativeTime } from "@/components/settings/relative-time";
import { DataTable, EmptyState, type ColumnDef } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import * as React from "react";

export interface ErrorDayCell {
  key: string;
  count: number;
}

const LEVELS = [25, 45, 70, 100] as const;

function level(n: number): number | null {
  if (n === 0) return null;
  if (n < 3) return LEVELS[0];
  if (n < 8) return LEVELS[1];
  if (n < 20) return LEVELS[2];
  return LEVELS[3];
}

function cellStyle(pct: number | null): React.CSSProperties | undefined {
  return pct == null ? undefined : { background: `color-mix(in oklch, var(--color-danger) ${pct}%, transparent)` };
}

export function ErrorHeatmap({ weeks }: { weeks: ErrorDayCell[][] }) {
  const t = useTranslations("cloud.heatmap");
  const format = useFormatter();
  return (
    <div className="surface overflow-x-auto p-4 sm:p-5">
      <div role="img" aria-label={t("aria")} className="flex gap-1">
        {weeks.map((week, i) => (
          <div key={week[0]?.key ?? i} className="flex flex-col gap-1">
            {week.map((c) => {
              const pct = level(c.count);
              return (
                <span
                  key={c.key}
                  title={t("cell", { date: format.dateTime(new Date(c.key), { dateStyle: "medium" }), count: c.count })}
                  className={cn("size-3.5 rounded-[var(--radius-sm)] transition-shadow hover:ring-1 hover:ring-border", pct == null && "bg-bg-muted")}
                  style={cellStyle(pct)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted" aria-hidden>
        <span>{t("legend.fewer")}</span>
        <span className="size-3 rounded-[var(--radius-sm)] bg-bg-muted" />
        {LEVELS.map((pct) => (
          <span key={pct} className="size-3 rounded-[var(--radius-sm)]" style={cellStyle(pct)} />
        ))}
        <span>{t("legend.more")}</span>
      </div>
    </div>
  );
}

export interface RecentErrorRow {
  id: number;
  createdAt: string;
  action: string;
  target: string | null;
  message: string | null;
}

export function RecentErrorsTable({ rows }: { rows: RecentErrorRow[] }) {
  const t = useTranslations("cloud.heatmap.recent");
  const columns: ColumnDef<RecentErrorRow>[] = React.useMemo(
    () => [
      {
        id: "when",
        header: t("columns.when"),
        accessorFn: (r) => r.createdAt,
        cell: ({ row }) => <RelativeTime date={row.original.createdAt} className="whitespace-nowrap text-xs text-fg-muted" />,
      },
      {
        id: "action",
        header: t("columns.action"),
        accessorFn: (r) => r.action,
        cell: ({ row }) => <code className="font-mono text-xs">{row.original.action}</code>,
      },
      {
        id: "target",
        header: t("columns.target"),
        accessorFn: (r) => r.target ?? "",
        cell: ({ row }) => <code className="block max-w-[14rem] truncate font-mono text-xs">{row.original.target ?? ""}</code>,
      },
      {
        id: "message",
        header: t("columns.message"),
        accessorFn: (r) => r.message ?? "",
        cell: ({ row }) => (
          <span className="block max-w-md truncate text-fg-muted" title={row.original.message ?? undefined}>
            {row.original.message ?? ""}
          </span>
        ),
      },
    ],
    [t],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      dense
      getRowId={(r) => String(r.id)}
      emptyState={<EmptyState compact icon={<AlertTriangle />} title={t("empty.title")} />}
    />
  );
}
