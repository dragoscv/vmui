"use client";

import { ProviderName, ProviderTile, useProviderLabel } from "@/components/cloud/provider-tile";
import { RelativeTime } from "@/components/settings/relative-time";
import { Button, DataTable, sortableHeader, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import { deleteFromTrashAction } from "@/server/actions/extras-2";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";

export interface TrashRow {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
  region: string;
  instanceType: string | null;
  terminatedAt: string;
}

export function TrashTable({ rows }: { rows: TrashRow[] }) {
  const t = useTranslations("cloud.trash");
  const providerLabel = useProviderLabel();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);

  const purge = useCallback(async (id: string) => {
    await deleteFromTrashAction(id);
    return ok();
  }, []);
  const { run, pending } = useAction(purge, { success: t("purged") });

  async function onPurge(row: TrashRow) {
    const label = row.name ?? row.providerInstanceId;
    const proceed = await confirm({
      title: t("confirm.title"),
      description: t("confirm.description", { name: label }),
      tone: "danger",
      confirmText: t("confirm.action"),
    });
    if (!proceed) return;
    setBusyId(row.id);
    await run(row.id);
    setBusyId(null);
  }

  const columns = useMemo<ColumnDef<TrashRow, unknown>[]>(
    () => [
      {
        accessorFn: (r) => `${r.name ?? ""} ${r.providerInstanceId}`,
        id: "name",
        header: sortableHeader(t("columns.name")),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.name ?? row.original.providerInstanceId}</div>
            <code className="block max-w-[16rem] truncate font-mono text-xs text-muted">{row.original.providerInstanceId}</code>
          </div>
        ),
      },
      {
        accessorFn: (r) => providerLabel(r.provider),
        id: "provider",
        header: t("columns.provider"),
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            <ProviderTile provider={row.original.provider} size="sm" />
            <ProviderName provider={row.original.provider} className="whitespace-nowrap" />
          </span>
        ),
      },
      { accessorKey: "region", header: t("columns.region"), cell: ({ row }) => <span className="whitespace-nowrap">{row.original.region}</span> },
      {
        accessorFn: (r) => r.instanceType ?? "",
        id: "type",
        header: t("columns.type"),
        cell: ({ row }) => <code className="font-mono text-xs">{row.original.instanceType ?? "—"}</code>,
      },
      {
        accessorKey: "terminatedAt",
        header: sortableHeader(t("columns.terminated")),
        cell: ({ row }) => <RelativeTime date={row.original.terminatedAt} className="whitespace-nowrap text-muted" />,
      },
    ],
    [t, providerLabel],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchable
      getRowId={(r) => r.id}
      rowActions={(row) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-danger hover:text-danger"
          loading={pending && busyId === row.id}
          disabled={pending}
          aria-label={t("purgeAria", { name: row.name ?? row.providerInstanceId })}
          onClick={() => void onPurge(row)}
        >
          <Trash2 className="size-3.5" aria-hidden />
          {t("purge")}
        </Button>
      )}
    />
  );
}
