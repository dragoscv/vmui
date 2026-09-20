"use client";

import { RelativeTime } from "@/components/settings/relative-time";
import { Badge, DataTable, sortableHeader, type ColumnDef } from "@/components/ui";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useKindLabel } from "./resource-format";

export interface DriftRow {
  id: string;
  kind: string;
  externalId: string;
  region: string;
  accountName: string | null;
  added: number;
  removed: number;
  capturedAt: string;
}

export function DriftTable({ rows }: { rows: DriftRow[] }) {
  const t = useTranslations("cloud.drift");
  const kindLabel = useKindLabel();

  const columns = useMemo<ColumnDef<DriftRow, unknown>[]>(
    () => [
      { accessorKey: "kind", header: t("columns.kind"), cell: ({ row }) => <Badge variant="info">{kindLabel(row.original.kind)}</Badge> },
      {
        accessorKey: "externalId",
        header: t("columns.id"),
        cell: ({ row }) => <code className="block max-w-[16rem] truncate font-mono text-xs">{row.original.externalId}</code>,
      },
      { accessorKey: "region", header: t("columns.region"), cell: ({ row }) => <span className="whitespace-nowrap">{row.original.region}</span> },
      {
        accessorFn: (r) => r.accountName ?? "",
        id: "account",
        header: t("columns.account"),
        cell: ({ row }) => <span className="block max-w-[12rem] truncate">{row.original.accountName ?? t("unknownAccount")}</span>,
      },
      {
        accessorFn: (r) => r.added + r.removed,
        id: "delta",
        header: sortableHeader(t("columns.delta")),
        cell: ({ row }) => (
          <span className="inline-flex gap-2 font-mono text-xs tabular-nums">
            <span className="text-success">+{row.original.added}</span>
            <span className="text-danger">−{row.original.removed}</span>
          </span>
        ),
      },
      {
        accessorKey: "capturedAt",
        header: sortableHeader(t("columns.when")),
        cell: ({ row }) => <RelativeTime date={row.original.capturedAt} className="whitespace-nowrap text-muted" />,
      },
    ],
    [t, kindLabel],
  );

  return <DataTable columns={columns} data={rows} searchable getRowId={(r) => r.id} dense />;
}
