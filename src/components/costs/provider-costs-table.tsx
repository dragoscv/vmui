"use client";

import { ProviderName, ProviderTile } from "@/components/cloud/provider-tile";
import { DataTable, Progress, sortableHeader, type ColumnDef } from "@/components/ui";
import { HOURS_PER_MONTH } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useMoney } from "./use-money";

export interface ProviderCostRow {
  provider: string;
  hourly: number;
  count: number;
  running: number;
}

export function ProviderCostsTable({ rows, totalHourly }: { rows: ProviderCostRow[]; totalHourly: number }) {
  const t = useTranslations("cloud.costs");
  const { usd, usdRate } = useMoney();

  const columns = useMemo<ColumnDef<ProviderCostRow>[]>(
    () => [
      {
        accessorKey: "provider",
        header: sortableHeader(t("byProvider.columns.provider")),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <ProviderTile provider={row.original.provider} size="sm" />
            <ProviderName provider={row.original.provider} className="font-medium" />
          </span>
        ),
      },
      {
        id: "running",
        accessorFn: (r) => r.running,
        header: sortableHeader(t("byProvider.columns.running")),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.running}/{row.original.count}
          </span>
        ),
      },
      {
        accessorKey: "hourly",
        header: sortableHeader(t("byProvider.columns.hourly")),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.hourly > 0 ? t("perHour", { amount: usdRate(row.original.hourly) }) : "—"}</span>
        ),
      },
      {
        id: "monthly",
        accessorFn: (r) => r.hourly * HOURS_PER_MONTH,
        header: sortableHeader(t("byProvider.columns.monthly")),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.hourly > 0 ? usd(row.original.hourly * HOURS_PER_MONTH) : "—"}</span>
        ),
      },
      {
        id: "share",
        accessorFn: (r) => (totalHourly > 0 ? (r.hourly / totalHourly) * 100 : 0),
        header: sortableHeader(t("byProvider.columns.share")),
        cell: ({ getValue }) => {
          const pct = getValue<number>();
          return (
            <span className="flex min-w-32 items-center gap-2">
              <Progress value={pct} size="sm" className="flex-1" />
              <span className="w-10 text-right text-xs tabular-nums text-muted">{Math.round(pct)}%</span>
            </span>
          );
        },
      },
    ],
    [t, usd, usdRate, totalHourly],
  );

  return <DataTable columns={columns} data={rows} dense getRowId={(r) => r.provider} />;
}
