"use client";

import { RelativeTime } from "@/components/settings/relative-time";
import { Badge, Button, DataTable, EmptyState, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import type { ActionResult } from "@/lib/action-result";
import { deleteInstanceSnapshotAction } from "@/server/actions/snapshots";
import type { SnapshotEvent } from "@/server/queries/snapshots";
import { HardDrive, RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { formatBytes } from "./bytes";

function statusVariant(status: string | null): "success" | "warning" | "danger" | "muted" {
  const s = (status ?? "").toLowerCase();
  if (s.includes("complet") || s === "ready" || s === "available" || s === "succeeded") return "success";
  if (s.includes("pending") || s.includes("creat") || s.includes("progress")) return "warning";
  if (s.includes("error") || s.includes("fail")) return "danger";
  return "muted";
}

export function SnapshotTable({ events }: { events: SnapshotEvent[] }) {
  const t = useTranslations("ops.backups.snapshots");
  const tc = useTranslations("common");
  const confirm = useConfirm();

  const remove = useAction(
    async (e: SnapshotEvent): Promise<ActionResult> => {
      const r = await deleteInstanceSnapshotAction({
        accountId: e.accountId,
        region: e.region,
        snapshotId: e.externalId,
      });
      return r.ok ? ok() : { ok: false, error: r.error };
    },
    { success: t("deleted") },
  );

  async function onRemove(e: SnapshotEvent) {
    const yes = await confirm({
      title: t("confirmDelete", { name: e.name ?? e.externalId }),
      description: t("confirmDeleteHint"),
      tone: "danger",
      confirmText: tc("delete"),
    });
    if (yes) await remove.run(e);
  }

  const columns = useMemo<ColumnDef<SnapshotEvent, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columns.name"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="block truncate font-medium">{row.original.name ?? row.original.externalId}</span>
            <code className="block truncate font-mono text-xs text-fg-muted">{row.original.externalId}</code>
          </div>
        ),
      },
      {
        accessorKey: "provider",
        header: t("columns.provider"),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="info">{row.original.provider}</Badge>
            <span className="text-xs text-fg-muted">{row.original.accountName}</span>
          </div>
        ),
      },
      {
        accessorKey: "region",
        header: t("columns.region"),
        cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs">{row.original.region}</span>,
      },
      {
        accessorKey: "sizeBytes",
        header: t("columns.size"),
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatBytes(row.original.sizeBytes)}</span>,
      },
      {
        accessorKey: "status",
        header: t("columns.status"),
        cell: ({ row }) =>
          row.original.status ? (
            <Badge variant={statusVariant(row.original.status)}>{row.original.status}</Badge>
          ) : (
            <span className="text-fg-muted">—</span>
          ),
      },
      {
        accessorKey: "capturedAt",
        header: t("columns.captured"),
        cell: ({ row }) => <RelativeTime date={row.original.capturedAt} className="whitespace-nowrap text-fg-muted" />,
      },
    ],
    [t],
  );

  return (
    <DataTable
      columns={columns}
      data={events}
      dense
      searchable
      getRowId={(e) => e.id}
      emptyState={
        <EmptyState
          compact
          icon={<HardDrive />}
          title={t("empty")}
          description={t("emptyHint")}
          action={
            <Button asChild size="sm">
              <Link href="/instances">{t("goToInstances")}</Link>
            </Button>
          }
        />
      }
      rowActions={(e) => (
        <>
          <Button asChild size="icon" variant="ghost" aria-label={t("restore")}>
            <Link href="/restore" title={t("restore")}>
              <RotateCcw className="size-4" aria-hidden />
            </Link>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void onRemove(e)}
            disabled={remove.pending}
            aria-label={t("delete")}
          >
            <Trash2 className="size-4 text-danger" aria-hidden />
          </Button>
        </>
      )}
    />
  );
}
