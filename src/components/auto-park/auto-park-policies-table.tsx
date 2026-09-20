"use client";

import { RelativeTime } from "@/components/settings/relative-time";
import { Badge, Button, DataTable, EmptyState, Switch, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import type { IdleParkPolicyRow } from "@/lib/db/schema";
import { disableIdleParkAction, setIdleParkPolicyAction } from "@/server/actions/automation";
import { Pause, Plus, Power } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export interface AutoParkRow extends IdleParkPolicyRow {
  instanceName: string | null;
}

export function AutoParkPoliciesTable({ rows }: { rows: AutoParkRow[] }) {
  const t = useTranslations("ops.autoPark");
  const tc = useTranslations("common");
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggle = useAction(
    async (row: AutoParkRow, enabled: boolean) => {
      setBusyId(row.id);
      try {
        if (enabled) {
          await setIdleParkPolicyAction({
            accountId: row.accountId,
            providerInstanceId: row.providerInstanceId,
            cpuPct: row.cpuPct,
            netKbps: row.netKbps,
            windowMin: row.windowMin,
            enabled: true,
          });
        } else {
          await disableIdleParkAction(row.id);
        }
      } finally {
        setBusyId(null);
      }
      return ok();
    },
    { success: t("updated") },
  );

  async function onDisable(row: AutoParkRow) {
    const yes = await confirm({
      title: t("confirmDisable", { name: row.instanceName ?? row.providerInstanceId }),
      description: t("confirmDisableHint"),
      tone: "warning",
      confirmText: t("disable"),
      cancelText: tc("cancel"),
    });
    if (yes) await toggle.run(row, false);
  }

  const columns: ColumnDef<AutoParkRow, unknown>[] = [
    {
      id: "vm",
      accessorFn: (r) => `${r.instanceName ?? ""} ${r.providerInstanceId}`,
      header: t("columns.vm"),
      cell: ({ row }) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{row.original.instanceName ?? row.original.providerInstanceId}</span>
          {row.original.instanceName && (
            <code className="block truncate font-mono text-xs text-fg-muted">{row.original.providerInstanceId}</code>
          )}
        </div>
      ),
    },
    {
      accessorKey: "cpuPct",
      header: t("columns.cpuMax"),
      cell: ({ row }) => <span className="tabular-nums">{t("values.cpu", { pct: row.original.cpuPct })}</span>,
    },
    {
      accessorKey: "netKbps",
      header: t("columns.netMax"),
      cell: ({ row }) => <span className="tabular-nums">{t("values.net", { kbps: row.original.netKbps })}</span>,
    },
    {
      accessorKey: "windowMin",
      header: t("columns.window"),
      cell: ({ row }) => <span className="tabular-nums">{tc("minutesShort", { n: row.original.windowMin })}</span>,
    },
    {
      accessorKey: "enabled",
      header: t("columns.status"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={row.original.enabled === 1}
            disabled={toggle.pending && busyId === row.original.id}
            onCheckedChange={(v) => (v ? void toggle.run(row.original, true) : void onDisable(row.original))}
            aria-label={t("toggleAria", { name: row.original.instanceName ?? row.original.providerInstanceId })}
          />
          <Badge variant={row.original.enabled === 1 ? "success" : "muted"} dot={row.original.enabled === 1}>
            {row.original.enabled === 1 ? t("status.active") : t("status.off")}
          </Badge>
        </div>
      ),
    },
    {
      accessorKey: "lastParkedAt",
      header: t("columns.lastParked"),
      cell: ({ row }) =>
        row.original.lastParkedAt ? (
          <RelativeTime date={row.original.lastParkedAt} className="whitespace-nowrap text-xs text-fg-muted" />
        ) : (
          <span className="text-xs text-fg-muted">{t("never")}</span>
        ),
    },
  ];

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
          icon={<Pause />}
          title={t("empty")}
          description={t("emptyHint")}
          action={
            <Button size="sm" asChild>
              <a href="#auto-park-form">
                <Plus className="size-4" aria-hidden /> {t("enable")}
              </a>
            </Button>
          }
        />
      }
      rowActions={(row) =>
        row.enabled === 1 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onDisable(row)}
            loading={toggle.pending && busyId === row.id}
            aria-label={t("disableAria", { name: row.instanceName ?? row.providerInstanceId })}
          >
            <Power className="size-3.5" aria-hidden /> {t("disable")}
          </Button>
        ) : null
      }
    />
  );
}
