"use client";

import { RelativeTime } from "@/components/settings/relative-time";
import { Badge, Button, DataTable, EmptyState, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import type { InstanceWebhookRow } from "@/lib/db/schema";
import { deleteInstanceWebhookAction, testInstanceWebhookAction } from "@/server/actions/extras";
import { Plus, Send, Trash2, Webhook } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

export interface InstanceWebhookViewRow extends InstanceWebhookRow {
  accountName: string | null;
}

function statusVariant(status: string | null): "success" | "danger" | "info" | "muted" {
  if (!status) return "muted";
  if (status === "ok" || /^2\d\d$/.test(status)) return "success";
  if (status === "queued" || status === "delivering") return "info";
  return "danger";
}

export function InstanceWebhooksTable({ rows }: { rows: InstanceWebhookViewRow[] }) {
  const t = useTranslations("ops.webhooks");
  const tc = useTranslations("common");
  const confirm = useConfirm();

  const remove = useAction(
    async (id: string) => {
      await deleteInstanceWebhookAction(id);
      return ok();
    },
    { success: t("deleted") },
  );
  const test = useAction(
    async (id: string): Promise<ActionResult> => {
      const r = await testInstanceWebhookAction(id);
      return r.ok ? ok() : { ok: false, error: r.error ?? t("testFailed") };
    },
    { success: t("tested") },
  );

  async function onRemove(row: InstanceWebhookViewRow) {
    const yes = await confirm({
      title: t("confirmDelete"),
      description: row.url,
      tone: "danger",
      confirmText: tc("delete"),
    });
    if (yes) await remove.run(row.id);
  }

  const columns = useMemo<ColumnDef<InstanceWebhookViewRow, unknown>[]>(
    () => [
      {
        accessorKey: "url",
        header: t("columns.url"),
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <code className="block min-w-0 max-w-[24rem] truncate font-mono text-xs" title={row.original.url}>
              {row.original.url}
            </code>
            {row.original.secret && <Badge variant="muted">{t("signed")}</Badge>}
            {!row.original.enabled && <Badge variant="muted">{tc("off")}</Badge>}
          </div>
        ),
      },
      {
        id: "scope",
        accessorFn: (r) => `${r.accountName ?? r.accountId ?? ""} ${r.providerInstanceId ?? ""}`,
        header: t("columns.scope"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0 text-xs">
            <span className="block truncate">{row.original.accountName ?? row.original.accountId ?? t("scopeAllAccounts")}</span>
            <span className="block truncate font-mono text-fg-muted">
              {row.original.providerInstanceId ?? t("scopeAllInstances")}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "lastFiredAt",
        header: t("columns.lastFire"),
        cell: ({ row }) =>
          row.original.lastFiredAt ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(row.original.lastStatus)}>{row.original.lastStatus ?? "—"}</Badge>
              <RelativeTime date={row.original.lastFiredAt} className="whitespace-nowrap text-xs text-fg-muted" />
            </div>
          ) : (
            <span className="text-xs text-fg-muted">{t("never")}</span>
          ),
      },
    ],
    [t, tc],
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
          icon={<Webhook />}
          title={t("empty")}
          description={t("emptyHint")}
          action={
            <Button size="sm" asChild>
              <a href="#webhook-form">
                <Plus className="size-4" aria-hidden /> {t("add")}
              </a>
            </Button>
          }
        />
      }
      rowActions={(row) => (
        <>
          <Button size="icon" variant="ghost" onClick={() => void test.run(row.id)} disabled={test.pending} aria-label={t("testAria")} title={t("test")}>
            <Send className="size-4" aria-hidden />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => void onRemove(row)} disabled={remove.pending} aria-label={t("deleteAria")}>
            <Trash2 className="size-4 text-danger" aria-hidden />
          </Button>
        </>
      )}
    />
  );
}
