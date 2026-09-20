"use client";

import { ProviderName, ProviderTile, useProviderLabel } from "@/components/cloud/provider-tile";
import { RelativeTime } from "@/components/settings/relative-time";
import { Button, DataTable, sortableHeader, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { err, ok, type ActionResult } from "@/lib/action-result";
import { deleteFromTrashAction, restoreFromTrashAction } from "@/server/actions/extras-2";
import { RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";

const RESTORABLE_PROVIDERS = new Set(["aws", "azure", "gcp"]);
const RESTORE_ERROR_CODES = new Set(["notFound", "unsupportedProvider", "noSnapshot"]);

export interface TrashRow {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
  region: string;
  instanceType: string | null;
  terminatedAt: string;
  safeSnapshotId: string | null;
}

export function TrashTable({ rows }: { rows: TrashRow[] }) {
  const t = useTranslations("cloud.trash");
  const providerLabel = useProviderLabel();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const purge = useCallback(async (id: string) => {
    await deleteFromTrashAction(id);
    return ok();
  }, []);
  const { run, pending } = useAction(purge, { success: t("purged") });

  const restore = useCallback(async (id: string): Promise<ActionResult<string>> => {
    const r = await restoreFromTrashAction({ id });
    if (r.ok) return ok(r.instanceId);
    return err(RESTORE_ERROR_CODES.has(r.error) ? `cloud.trash.errors.${r.error}` : r.error || "cloud.trash.errors.generic");
  }, []);
  const { run: runRestore, pending: restorePending } = useAction(restore, { success: t("restored"), refresh: true });

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

  function canRestore(row: TrashRow) {
    return RESTORABLE_PROVIDERS.has(row.provider) && row.safeSnapshotId !== null;
  }

  async function onRestore(row: TrashRow) {
    const label = row.name ?? row.providerInstanceId;
    const proceed = await confirm({
      title: t("restoreConfirm.title"),
      description: t("restoreConfirm.description", { name: label }),
      tone: "warning",
      confirmText: t("restoreConfirm.action"),
    });
    if (!proceed) return;
    setRestoringId(row.id);
    await runRestore(row.id);
    setRestoringId(null);
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
        accessorFn: (r) => r.safeSnapshotId ?? "",
        id: "snapshot",
        header: t("columns.snapshot"),
        cell: ({ row }) => (
          <code className="block max-w-[14rem] truncate font-mono text-xs text-muted" title={row.original.safeSnapshotId ?? undefined}>
            {row.original.safeSnapshotId ?? "—"}
          </code>
        ),
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
      rowActions={(row) => {
        const label = row.name ?? row.providerInstanceId;
        const restorable = canRestore(row);
        return (
          <div className="flex items-center gap-1">
            <span title={restorable ? undefined : t("restoreUnavailable")}>
              <Button
                variant="primary"
                size="sm"
                loading={restorePending && restoringId === row.id}
                disabled={!restorable || restorePending || pending}
                aria-label={t("restoreAria", { name: label })}
                onClick={() => void onRestore(row)}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {t("restore")}
              </Button>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger"
              loading={pending && busyId === row.id}
              disabled={pending || restorePending}
              aria-label={t("purgeAria", { name: label })}
              onClick={() => void onPurge(row)}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {t("purge")}
            </Button>
          </div>
        );
      }}
    />
  );
}
