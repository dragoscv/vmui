"use client";

import { Badge, Button, DataTable, Progress, type ColumnDef, type ProgressTone } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import { deleteTagBudgetAction } from "@/server/actions/automation";
import { Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import * as React from "react";

export interface TagBudgetRow {
  id: string;
  tagKey: string;
  tagValue: string | null;
  monthlyUsd: number;
  lastObservedUsd: number | null;
  exceeded: boolean;
}

export function utilisationTone(ratio: number): ProgressTone {
  if (ratio < 0.7) return "success";
  if (ratio < 0.9) return "warning";
  return "danger";
}

function DeleteButton({ row }: { row: TagBudgetRow }) {
  const t = useTranslations("cloud.budgets");
  const confirm = useConfirm();
  const tag = `${row.tagKey}:${row.tagValue ?? "*"}`;
  const remove = useAction(
    async () => {
      await deleteTagBudgetAction(row.id);
      return ok();
    },
    { success: t("delete.done") },
  );
  return (
    <Button
      variant="ghost"
      size="icon"
      loading={remove.pending}
      aria-label={t("delete.label", { tag })}
      onClick={async () => {
        const yes = await confirm({
          title: t("delete.title", { tag }),
          description: t("delete.description"),
          tone: "danger",
          confirmText: t("delete.confirm"),
        });
        if (yes) await remove.run();
      }}
    >
      <Trash2 className="size-4 text-danger" aria-hidden />
    </Button>
  );
}

export function TagBudgetsTable({ rows }: { rows: TagBudgetRow[] }) {
  const t = useTranslations("cloud.budgets");
  const format = useFormatter();
  const usd = React.useCallback((n: number) => format.number(n, { style: "currency", currency: "USD" }), [format]);

  const columns: ColumnDef<TagBudgetRow>[] = React.useMemo(
    () => [
      {
        id: "tag",
        header: t("columns.tag"),
        accessorFn: (r) => `${r.tagKey}:${r.tagValue ?? "*"}`,
        cell: ({ row }) => (
          <code className="block max-w-[14rem] truncate font-mono text-xs">
            {row.original.tagKey}:{row.original.tagValue ?? "*"}
          </code>
        ),
      },
      {
        id: "cap",
        header: t("columns.cap"),
        accessorFn: (r) => r.monthlyUsd,
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{t("perMonth", { amount: usd(row.original.monthlyUsd) })}</span>,
      },
      {
        id: "observed",
        header: t("columns.observed"),
        accessorFn: (r) => r.lastObservedUsd ?? 0,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.lastObservedUsd != null ? usd(row.original.lastObservedUsd) : <span className="text-fg-muted">—</span>}</span>
        ),
      },
      {
        id: "utilisation",
        header: t("columns.utilisation"),
        enableSorting: false,
        cell: ({ row }) => {
          const observed = row.original.lastObservedUsd ?? 0;
          const ratio = row.original.monthlyUsd > 0 ? observed / row.original.monthlyUsd : 0;
          return (
            <div className="flex min-w-[8rem] items-center gap-2">
              <Progress size="sm" value={observed} max={row.original.monthlyUsd} tone={utilisationTone(ratio)} className="flex-1" />
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-fg-muted">{Math.round(ratio * 100)}%</span>
            </div>
          );
        },
      },
      {
        id: "status",
        header: t("columns.status"),
        accessorFn: (r) => (r.exceeded ? 1 : 0),
        cell: ({ row }) =>
          row.original.exceeded ? <Badge variant="danger">{t("status.exceeded")}</Badge> : <Badge variant="success">{t("status.ok")}</Badge>,
      },
    ],
    [t, usd],
  );

  return <DataTable columns={columns} data={rows} getRowId={(r) => r.id} rowActions={(row) => <DeleteButton row={row} />} />;
}
