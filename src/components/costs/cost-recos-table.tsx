"use client";

import { ProviderName, ProviderTile } from "@/components/cloud/provider-tile";
import { DataTable, sortableHeader, type ColumnDef } from "@/components/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { useMoney } from "./use-money";

export interface CostRecoRow {
  instanceId: string;
  name: string;
  provider: string;
  region: string;
  current: { type: string; usdPerHour: number };
  suggested: { type: string; usdPerHour: number } | null;
  reason: string;
  monthlySavingsUsd: number;
}

export function CostRecosTable({ rows }: { rows: CostRecoRow[] }) {
  const t = useTranslations("cloud.recos");
  const { usd, usdRate } = useMoney();

  const columns = useMemo<ColumnDef<CostRecoRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: sortableHeader(t("columns.vm")),
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <ProviderTile provider={row.original.provider} size="sm" />
            <span className="min-w-0">
              <Link
                href={`/instances/${encodeURIComponent(row.original.instanceId)}`}
                className="block truncate font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {row.original.name}
              </Link>
              <ProviderName provider={row.original.provider} className="block text-[11px] text-muted" />
            </span>
          </span>
        ),
      },
      {
        accessorKey: "region",
        header: sortableHeader(t("columns.region")),
        cell: ({ getValue }) => <span className="text-xs text-muted">{getValue<string>()}</span>,
      },
      {
        id: "current",
        accessorFn: (r) => r.current.type,
        header: sortableHeader(t("columns.current")),
        cell: ({ row }) => (
          <span className="block font-mono text-xs">
            {row.original.current.type}
            <span className="block text-[11px] text-muted">{t("perHour", { amount: usdRate(row.original.current.usdPerHour) })}</span>
          </span>
        ),
      },
      {
        id: "suggested",
        accessorFn: (r) => r.suggested?.type ?? "",
        header: sortableHeader(t("columns.suggested")),
        cell: ({ row }) =>
          row.original.suggested ? (
            <span className="block font-mono text-xs text-success">
              {row.original.suggested.type}
              <span className="block text-[11px] opacity-80">{t("perHour", { amount: usdRate(row.original.suggested.usdPerHour) })}</span>
            </span>
          ) : (
            <span className="text-muted">{t("noSuggestion")}</span>
          ),
      },
      {
        accessorKey: "monthlySavingsUsd",
        header: sortableHeader(t("columns.savings")),
        cell: ({ getValue }) => <span className="font-medium tabular-nums text-success">{usd(getValue<number>())}</span>,
      },
      {
        accessorKey: "reason",
        header: t("columns.reason"),
        enableSorting: false,
        cell: ({ getValue }) => <span className="block max-w-[28rem] text-xs text-muted">{getValue<string>()}</span>,
      },
    ],
    [t, usd, usdRate],
  );

  return <DataTable columns={columns} data={rows} searchable getRowId={(r) => r.instanceId} />;
}
