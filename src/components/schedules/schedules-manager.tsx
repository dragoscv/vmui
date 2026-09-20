"use client";

import { RelativeTime } from "@/components/settings/relative-time";
import { Badge, Button, DataTable, EmptyState, Switch, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import { nextRun } from "@/lib/cron";
import { deleteScheduleAction, setScheduleEnabledAction } from "@/server/actions/schedules";
import { Clock, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ScheduleForm, type ScheduleAction } from "./schedule-form";

interface ScheduleSummary {
  id: string;
  cron: string;
  action: ScheduleAction;
  enabled: boolean;
  label: string | null;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  instanceName: string;
  accountName: string;
}

const ACTION_VARIANT: Record<ScheduleAction, "warning" | "success" | "info"> = {
  stop: "warning",
  start: "success",
  reboot: "info",
  snapshot: "info",
};

function runStatusVariant(s: string | null): "success" | "danger" | "muted" {
  if (!s) return "muted";
  const v = s.toLowerCase();
  if (v === "ok" || v === "success") return "success";
  if (v.includes("err") || v.includes("fail")) return "danger";
  return "muted";
}

export function SchedulesManager({
  initialSchedules,
  instances,
}: {
  initialSchedules: ScheduleSummary[];
  instances: { id: string; label: string }[];
}) {
  const t = useTranslations("ops.schedules");
  const tc = useTranslations("common");
  const format = useFormatter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);

  const toggle = useAction(
    async (id: string, enabled: boolean): Promise<ActionResult> => {
      const r = await setScheduleEnabledAction(id, enabled);
      return r.ok ? ok() : { ok: false, error: tc("error") };
    },
    { success: undefined },
  );
  const remove = useAction(
    async (id: string): Promise<ActionResult> => {
      const r = await deleteScheduleAction(id);
      return r.ok ? ok() : { ok: false, error: tc("error") };
    },
    { success: t("deleted") },
  );

  async function onRemove(s: ScheduleSummary) {
    const yes = await confirm({
      title: t("confirmDelete", { name: s.label ?? `${t(`form.actions.${s.action}`)} · ${s.instanceName}` }),
      description: t("confirmDeleteHint"),
      tone: "danger",
      confirmText: tc("delete"),
    });
    if (yes) await remove.run(s.id);
  }

  const columns = useMemo<ColumnDef<ScheduleSummary, unknown>[]>(
    () => [
      {
        accessorKey: "cron",
        header: t("columns.cron"),
        cell: ({ row }) => {
          const nr = nextRun(row.original.cron);
          return (
            <div className="min-w-0">
              <code className="block font-mono text-xs">{row.original.cron}</code>
              {nr && row.original.enabled && (
                <span className="block text-[11px] text-fg-muted">{t("next", { when: format.dateTime(nr, { dateStyle: "medium", timeStyle: "short" }) })}</span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "action",
        header: t("columns.action"),
        cell: ({ row }) => <Badge variant={ACTION_VARIANT[row.original.action]}>{t(`form.actions.${row.original.action}`)}</Badge>,
      },
      {
        accessorKey: "instanceName",
        header: t("columns.instance"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="block truncate font-medium">{row.original.instanceName}</span>
            {row.original.label && <span className="block truncate text-xs text-fg-muted">{row.original.label}</span>}
          </div>
        ),
      },
      {
        accessorKey: "accountName",
        header: t("columns.account"),
        cell: ({ row }) => <span className="block max-w-[12rem] truncate text-xs text-fg-muted">{row.original.accountName}</span>,
      },
      {
        accessorKey: "enabled",
        header: t("columns.enabled"),
        enableSorting: false,
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={toggle.pending}
            onCheckedChange={(v) => void toggle.run(row.original.id, v)}
            aria-label={row.original.enabled ? t("pause") : t("resume")}
          />
        ),
      },
      {
        accessorKey: "lastRunAt",
        header: t("columns.lastRun"),
        cell: ({ row }) =>
          row.original.lastRunAt ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={runStatusVariant(row.original.lastRunStatus)}>{row.original.lastRunStatus ?? "—"}</Badge>
              <RelativeTime date={row.original.lastRunAt} className="whitespace-nowrap text-xs text-fg-muted" />
            </div>
          ) : (
            <span className="text-xs text-fg-muted">{t("never")}</span>
          ),
      },
    ],
    [t, format, toggle.run, toggle.pending],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={initialSchedules}
        dense
        searchable={initialSchedules.length > 5}
        getRowId={(s) => s.id}
        toolbar={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden /> {t("add")}
          </Button>
        }
        emptyState={
          <EmptyState
            compact
            icon={<Clock />}
            title={t("empty")}
            description={t("emptyHint")}
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="size-4" aria-hidden /> {t("add")}
              </Button>
            }
          />
        }
        rowActions={(s) => (
          <Button size="icon" variant="ghost" onClick={() => void onRemove(s)} disabled={remove.pending} aria-label={tc("delete")}>
            <Trash2 className="size-4 text-danger" aria-hidden />
          </Button>
        )}
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title={t("newTitle")} description={t("newDescription")} className="md:w-[560px]">
          <ScheduleForm instances={instances} onDone={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
