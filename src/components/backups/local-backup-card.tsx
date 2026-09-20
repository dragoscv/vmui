"use client";

import { RelativeTime } from "@/components/settings/relative-time";
import { Badge, Button, DataTable, EmptyState, PageSection, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import type { BackupFileSummary } from "@/lib/local-backup";
import { deleteLocalBackupAction, verifyLocalBackupAction, writeLocalBackupAction } from "@/server/actions/local-backup";
import { Archive, Download, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { formatBytes } from "./bytes";

export function LocalBackupCard({ initialBackups }: { initialBackups: BackupFileSummary[] }) {
  const t = useTranslations("ops.backups.local");
  const tc = useTranslations("common");
  const confirm = useConfirm();
  const [backups, setBackups] = useState(initialBackups);
  const [refreshing, startRefresh] = useTransition();

  const refresh = () => {
    startRefresh(async () => {
      const res = await fetch("/api/local-backups");
      if (res.ok) setBackups((await res.json()) as BackupFileSummary[]);
    });
  };

  const create = useAction(
    async (): Promise<ActionResult<string>> => {
      const out = await writeLocalBackupAction();
      if (!out.ok) return { ok: false, error: out.error ?? t("createFailed") };
      refresh();
      return ok(out.file?.name ?? "");
    },
    { success: (name) => t("created", { name }), refresh: false },
  );

  const verify = useAction(
    async (name: string): Promise<ActionResult<string>> => {
      const out = await verifyLocalBackupAction({ name });
      if (!out.ok) return { ok: false, error: out.error ?? t("verifyFailed") };
      const counts = Object.entries(out.counts ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(" · ");
      return ok(counts);
    },
    { success: (counts) => t("verified", { counts }), refresh: false },
  );

  const remove = useAction(
    async (name: string): Promise<ActionResult> => {
      const out = await deleteLocalBackupAction({ name });
      if (!out.ok) return { ok: false, error: out.error ?? t("deleteFailed") };
      refresh();
      return ok();
    },
    { success: t("deleted"), refresh: false },
  );

  async function onRemove(b: BackupFileSummary) {
    const yes = await confirm({
      title: t("confirmDelete", { name: b.name }),
      description: t("confirmDeleteHint"),
      tone: "danger",
      confirmText: tc("delete"),
    });
    if (yes) await remove.run(b.name);
  }

  const columns = useMemo<ColumnDef<BackupFileSummary, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columns.file"),
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <code className="block truncate font-mono text-xs">{row.original.name}</code>
            {row.original.partial && <Badge variant="warning">{t("partial")}</Badge>}
          </div>
        ),
      },
      {
        accessorKey: "bytes",
        header: t("columns.size"),
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-xs">{formatBytes(row.original.bytes)}</span>,
      },
      {
        accessorKey: "modifiedAt",
        header: t("columns.modified"),
        cell: ({ row }) => <RelativeTime date={row.original.modifiedAt} className="whitespace-nowrap text-xs text-fg-muted" />,
      },
    ],
    [t],
  );

  return (
    <PageSection
      title={t("title")}
      description={t.rich("description", { code: (chunks: ReactNode) => <code className="font-mono">{chunks}</code> })}
      action={
        <>
          <Button variant="ghost" size="icon" onClick={refresh} loading={refreshing} aria-label={tc("refresh")}>
            <RefreshCw className="size-4" aria-hidden />
          </Button>
          <Button size="sm" onClick={() => void create.run()} loading={create.pending}>
            <Download className="size-4" aria-hidden /> {t("createNow")}
          </Button>
        </>
      }
    >
      <DataTable
        columns={columns}
        data={backups}
        dense
        getRowId={(b) => b.name}
        emptyState={
          <EmptyState
            compact
            icon={<Archive />}
            title={t("empty")}
            description={t("emptyHint")}
            action={
              <Button size="sm" onClick={() => void create.run()} loading={create.pending}>
                <Download className="size-4" aria-hidden /> {t("createNow")}
              </Button>
            }
          />
        }
        rowActions={(b) => (
          <>
            <Button size="sm" variant="ghost" onClick={() => void verify.run(b.name)} disabled={verify.pending}>
              <ShieldCheck className="size-4" aria-hidden /> {t("verify")}
            </Button>
            <Button size="icon" variant="ghost" onClick={() => void onRemove(b)} disabled={remove.pending} aria-label={tc("delete")}>
              <Trash2 className="size-4 text-danger" aria-hidden />
            </Button>
          </>
        )}
      />
    </PageSection>
  );
}
