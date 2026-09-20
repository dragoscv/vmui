"use client";

import { ProviderTile } from "@/components/cloud/provider-tile";
import { Badge, DataTable, sortableHeader, type ColumnDef } from "@/components/ui";
import { HOURS_PER_MONTH } from "@/lib/utils";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { useMoney } from "./use-money";

export interface SpenderRow {
  id: string;
  name: string | null;
  provider: string;
  region: string;
  instanceType: string | null;
  hourly: number | null;
  source: string | null;
  fetchedAt: string | null;
}

const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

function PriceSource({ source, fetchedAt }: { source: string | null; fetchedAt: string | null }) {
  const t = useTranslations("cloud.costs.topSpenders.source");
  if (!source) return <span className="text-muted">—</span>;
  if (source === "static") {
    return (
      <Badge variant="warning" title={t("static")}>
        {source}
      </Badge>
    );
  }
  const ageMs = fetchedAt ? Date.now() - new Date(fetchedAt).getTime() : null;
  if (ageMs !== null && ageMs > STALE_AFTER_MS) {
    const hours = Math.round(ageMs / 3_600_000);
    return (
      <Badge variant="warning" title={t("stale", { hours })}>
        {t("staleLabel", { source, hours })}
      </Badge>
    );
  }
  return <Badge variant="muted">{source}</Badge>;
}

export function TopSpendersTable({ rows }: { rows: SpenderRow[] }) {
  const t = useTranslations("cloud.costs");
  const { usd, usdRate } = useMoney();

  const columns = useMemo<ColumnDef<SpenderRow>[]>(
    () => [
      {
        id: "instance",
        accessorFn: (r) => r.name ?? r.id,
        header: sortableHeader(t("topSpenders.columns.instance")),
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <ProviderTile provider={row.original.provider} size="sm" />
            <Link
              href={`/instances/${encodeURIComponent(row.original.id)}`}
              className="truncate font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {row.original.name ?? row.original.id}
            </Link>
          </span>
        ),
      },
      {
        accessorKey: "instanceType",
        header: sortableHeader(t("topSpenders.columns.type")),
        cell: ({ getValue }) => <span className="font-mono text-xs text-muted">{getValue<string | null>() ?? "—"}</span>,
      },
      {
        accessorKey: "region",
        header: sortableHeader(t("topSpenders.columns.region")),
        cell: ({ getValue }) => <span className="text-xs text-muted">{getValue<string>()}</span>,
      },
      {
        id: "hourly",
        accessorFn: (r) => r.hourly ?? 0,
        header: sortableHeader(t("topSpenders.columns.hourly")),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.hourly ? t("perHour", { amount: usdRate(row.original.hourly) }) : "—"}</span>
        ),
      },
      {
        id: "monthly",
        accessorFn: (r) => (r.hourly ?? 0) * HOURS_PER_MONTH,
        header: sortableHeader(t("topSpenders.columns.monthly")),
        cell: ({ row }) => <span className="tabular-nums">{row.original.hourly ? usd(row.original.hourly * HOURS_PER_MONTH) : "—"}</span>,
      },
      {
        accessorKey: "source",
        header: t("topSpenders.columns.source"),
        enableSorting: false,
        cell: ({ row }) => <PriceSource source={row.original.source} fetchedAt={row.original.fetchedAt} />,
      },
    ],
    [t, usd, usdRate],
  );

  return <DataTable columns={columns} data={rows} dense getRowId={(r) => r.id} />;
}
