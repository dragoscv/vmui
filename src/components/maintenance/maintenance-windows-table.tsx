"use client";

import { toResult } from "@/components/settings/adapt";
import { Badge, Button, DataTable, EmptyState, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { deleteMaintenanceWindowAction } from "@/server/actions/maintenance";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";

export type MaintenanceStatus = "active" | "upcoming" | "past";

export interface MaintenanceRow {
  id: string;
  name: string;
  reason: string | null;
  startsAt: Date;
  endsAt: Date;
  mode: "block" | "warn";
  scope: string | null;
  status: MaintenanceStatus;
}

const STATUS_VARIANT: Record<MaintenanceStatus, "warning" | "info" | "muted"> = {
  active: "warning",
  upcoming: "info",
  past: "muted",
};

export function MaintenanceWindowsTable({ rows }: { rows: MaintenanceRow[] }) {
  const t = useTranslations("ops.maintenance");
  const tc = useTranslations("common");
  const format = useFormatter();
  const confirm = useConfirm();

  const remove = useAction(async (id: string) => toResult(await deleteMaintenanceWindowAction(id)), {
    success: t("deleted"),
  });

  async function onRemove(row: MaintenanceRow) {
    const yes = await confirm({
      title: t("confirmDelete", { name: row.name }),
      description: t("confirmDeleteHint"),
      tone: "danger",
      confirmText: tc("delete"),
    });
    if (yes) await remove.run(row.id);
  }

  const columns = useMemo<ColumnDef<MaintenanceRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columns.name"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="block truncate font-medium">{row.original.name}</span>
            {row.original.reason && <span className="block truncate text-xs text-fg-muted">{row.original.reason}</span>}
          </div>
        ),
      },
      {
        accessorKey: "startsAt",
        header: t("columns.when"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-fg-muted tabular-nums">
            {format.dateTime(row.original.startsAt, { dateStyle: "medium", timeStyle: "short" })}
            {" → "}
            {format.dateTime(row.original.endsAt, { dateStyle: "medium", timeStyle: "short" })}
          </span>
        ),
      },
      {
        accessorKey: "mode",
        header: t("columns.mode"),
        cell: ({ row }) => (
          <Badge variant={row.original.mode === "block" ? "danger" : "muted"}>{t(`modes.${row.original.mode}`)}</Badge>
        ),
      },
      {
        accessorKey: "scope",
        header: t("columns.scope"),
        cell: ({ row }) => (
          <span className="block max-w-[14rem] truncate text-xs text-fg-muted">{row.original.scope ?? t("scopeGlobal")}</span>
        ),
      },
      {
        accessorKey: "status",
        header: t("columns.status"),
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status]} dot={row.original.status === "active"}>
            {t(`status.${row.original.status}`)}
          </Badge>
        ),
      },
    ],
    [t, format],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      dense
      searchable
      getRowId={(r) => r.id}
      emptyState={
        <EmptyState
          compact
          icon={<CalendarClock />}
          title={t("empty")}
          description={t("emptyHint")}
          action={
            <Button size="sm" asChild>
              <a href="#maintenance-form">
                <Plus className="size-4" aria-hidden /> {t("create")}
              </a>
            </Button>
          }
        />
      }
      rowActions={(row) => (
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void onRemove(row)}
          disabled={remove.pending}
          aria-label={t("deleteAria", { name: row.name })}
        >
          <Trash2 className="size-4 text-danger" aria-hidden />
        </Button>
      )}
    />
  );
}
