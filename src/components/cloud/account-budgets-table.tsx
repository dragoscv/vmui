"use client";

import { ProviderTile } from "@/components/cloud/provider-tile";
import { utilisationTone } from "@/components/cloud/tag-budgets-table";
import { RelativeTime } from "@/components/settings/relative-time";
import { Badge, Button, DataTable, Input, Progress, type ColumnDef } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import { deleteAccountBudgetAction, setAccountBudgetAction } from "@/server/actions/templates-and-budgets";
import { useFormatter, useTranslations } from "next-intl";
import * as React from "react";

export interface AccountBudgetRow {
  accountId: string;
  name: string;
  provider: string;
  projectedMonthly: number;
  cap: number | null;
  alertedAt: string | null;
}

function CapEditor({ row }: { row: AccountBudgetRow }) {
  const t = useTranslations("cloud.accountBudgets");
  const tc = useTranslations("common");
  const [value, setValue] = React.useState(row.cap != null ? String(row.cap) : "");
  React.useEffect(() => {
    setValue(row.cap != null ? String(row.cap) : "");
  }, [row.cap]);
  const save = useAction(
    async (monthlyUsd: number) => {
      await setAccountBudgetAction({ accountId: row.accountId, monthlyUsd });
      return ok();
    },
    { success: t("saved") },
  );
  const dirty = value !== (row.cap != null ? String(row.cap) : "");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run(Number(value || 0));
      }}
    >
      <Input
        type="number"
        step="0.01"
        min={0}
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t("capLabel", { name: row.name })}
        className="w-28 text-right tabular-nums"
      />
      <Button type="submit" size="sm" variant={dirty ? "primary" : "outline"} loading={save.pending} disabled={!dirty}>
        {tc("save")}
      </Button>
    </form>
  );
}

function ClearButton({ row }: { row: AccountBudgetRow }) {
  const t = useTranslations("cloud.accountBudgets");
  const tc = useTranslations("common");
  const clear = useAction(
    async () => {
      await deleteAccountBudgetAction(row.accountId);
      return ok();
    },
    { success: t("cleared") },
  );
  if (row.cap == null) return null;
  return (
    <Button variant="ghost" size="sm" loading={clear.pending} aria-label={t("clearLabel", { name: row.name })} onClick={() => void clear.run()}>
      {tc("clear")}
    </Button>
  );
}

export function AccountBudgetsTable({ rows }: { rows: AccountBudgetRow[] }) {
  const t = useTranslations("cloud.accountBudgets");
  const format = useFormatter();
  const usd = React.useCallback((n: number) => format.number(n, { style: "currency", currency: "USD" }), [format]);

  const columns: ColumnDef<AccountBudgetRow>[] = React.useMemo(
    () => [
      {
        id: "account",
        header: t("columns.account"),
        accessorFn: (r) => r.name,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <ProviderTile provider={row.original.provider} size="sm" />
            <span className="min-w-0 truncate font-medium">{row.original.name}</span>
          </div>
        ),
      },
      {
        id: "projected",
        header: t("columns.projected"),
        accessorFn: (r) => r.projectedMonthly,
        cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{t("perMonth", { amount: usd(row.original.projectedMonthly) })}</span>,
      },
      {
        id: "cap",
        header: t("columns.cap"),
        enableSorting: false,
        cell: ({ row }) => <CapEditor row={row.original} />,
      },
      {
        id: "utilisation",
        header: t("columns.utilisation"),
        enableSorting: false,
        cell: ({ row }) => {
          const cap = row.original.cap;
          if (cap == null || cap <= 0) return <span className="text-fg-muted">—</span>;
          const ratio = row.original.projectedMonthly / cap;
          return (
            <div className="flex min-w-[8rem] items-center gap-2">
              <Progress size="sm" value={row.original.projectedMonthly} max={cap} tone={utilisationTone(ratio)} className="flex-1" />
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-fg-muted">{Math.round(ratio * 100)}%</span>
            </div>
          );
        },
      },
      {
        id: "status",
        header: t("columns.status"),
        accessorFn: (r) => (r.cap == null || r.cap <= 0 ? -1 : r.projectedMonthly / r.cap),
        cell: ({ row }) => {
          const cap = row.original.cap;
          const ratio = cap != null && cap > 0 ? row.original.projectedMonthly / cap : null;
          const badge =
            ratio == null ? (
              <Badge variant="muted">{t("status.none")}</Badge>
            ) : ratio >= 1 ? (
              <Badge variant="danger">{t("status.over")}</Badge>
            ) : ratio >= 0.8 ? (
              <Badge variant="warning">{t("status.warning")}</Badge>
            ) : (
              <Badge variant="success">{t("status.ok")}</Badge>
            );
          return (
            <div className="flex flex-col gap-1">
              <span>{badge}</span>
              {row.original.alertedAt && (
                <span className="text-xs text-fg-muted">
                  {t("alerted")} <RelativeTime date={row.original.alertedAt} />
                </span>
              )}
            </div>
          );
        },
      },
    ],
    [t, usd],
  );

  return <DataTable columns={columns} data={rows} getRowId={(r) => r.accountId} rowActions={(row) => <ClearButton row={row} />} />;
}
