"use client";

import { LogViewer } from "@/components/ops/log-viewer";
import { RelativeTime } from "@/components/settings/relative-time";
import { Badge, Button, DataTable, EmptyState, type ColumnDef } from "@/components/ui";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import type { WebhookDeliveryRow } from "@/lib/db/schema";
import { retryWebhookDeliveryAction } from "@/server/actions/webhooks";
import { Eye, RotateCcw, Send } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

type Status = WebhookDeliveryRow["status"];

const STATUS_VARIANT: Record<Status, "info" | "warning" | "success" | "danger"> = {
  queued: "info",
  delivering: "warning",
  ok: "success",
  failed: "danger",
};

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function WebhookDeliveriesTable({ rows }: { rows: WebhookDeliveryRow[] }) {
  const t = useTranslations("ops.deliveries");
  const format = useFormatter();
  const [selected, setSelected] = useState<WebhookDeliveryRow | null>(null);

  const retry = useAction(
    async (id: string): Promise<ActionResult> => {
      const r = await retryWebhookDeliveryAction(id);
      if (r.ok) return ok();
      if (r.error === "notRetryable") return { ok: false, error: t("notRetryable") };
      return { ok: false, error: r.error ?? t("retryFailed") };
    },
    { success: t("retried") },
  );

  const columns = useMemo<ColumnDef<WebhookDeliveryRow, unknown>[]>(
    () => [
      {
        accessorKey: "url",
        header: t("columns.url"),
        cell: ({ row }) => (
          <code className="block min-w-0 max-w-[22rem] truncate font-mono text-xs" title={row.original.url}>
            {row.original.url}
          </code>
        ),
      },
      {
        accessorKey: "status",
        header: t("columns.status"),
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status]} dot={row.original.status === "delivering"}>
            {t(`status.${row.original.status}`)}
          </Badge>
        ),
      },
      {
        accessorKey: "attempts",
        header: t("columns.attempts"),
        cell: ({ row }) => (
          <span className="tabular-nums text-xs">
            {row.original.attempts}/{row.original.maxAttempts}
          </span>
        ),
      },
      {
        id: "when",
        accessorFn: (r) => (r.deliveredAt ?? r.nextAttemptAt).getTime(),
        header: t("columns.when"),
        cell: ({ row }) => {
          const d = row.original.deliveredAt ?? row.original.nextAttemptAt;
          return (
            <div className="min-w-0 text-xs">
              <span className="block text-fg-muted">{row.original.deliveredAt ? t("deliveredAt") : t("nextAttemptAt")}</span>
              <RelativeTime date={d} className="whitespace-nowrap" />
            </div>
          );
        },
      },
      {
        accessorKey: "lastErrorMessage",
        header: t("columns.lastError"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.lastErrorMessage ? (
            <span className="block min-w-0 max-w-[18rem] truncate text-xs text-danger" title={row.original.lastErrorMessage}>
              {row.original.lastErrorMessage}
            </span>
          ) : (
            <span className="text-xs text-fg-muted">—</span>
          ),
      },
    ],
    [t],
  );

  const detailLines = useMemo(() => {
    if (!selected) return [];
    const out: string[] = [];
    out.push(`# ${t("detail.status")}: ${selected.status} (${selected.attempts}/${selected.maxAttempts})`);
    out.push(`# ${t("detail.url")}: ${selected.url}`);
    out.push(`# ${t("detail.created")}: ${format.dateTime(selected.createdAt, { dateStyle: "medium", timeStyle: "medium" })}`);
    if (selected.deliveredAt)
      out.push(`# ${t("detail.delivered")}: ${format.dateTime(selected.deliveredAt, { dateStyle: "medium", timeStyle: "medium" })}`);
    else
      out.push(`# ${t("detail.nextAttempt")}: ${format.dateTime(selected.nextAttemptAt, { dateStyle: "medium", timeStyle: "medium" })}`);
    if (selected.signature) out.push(`# x-vmui-signature: ${selected.signature}`);
    if (selected.lastErrorMessage) {
      out.push("");
      out.push(`! ${t("detail.lastError")}`);
      for (const l of selected.lastErrorMessage.split("\n")) out.push(`! ${l}`);
    }
    out.push("");
    out.push(`# ${t("detail.payload")}`);
    for (const l of prettyJson(selected.payloadJson).split("\n")) out.push(l);
    return out;
  }, [selected, t, format]);

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        dense
        searchable
        getRowId={(r) => r.id}
        onRowClick={(r) => setSelected(r)}
        emptyState={<EmptyState compact icon={<Send />} title={t("empty")} description={t("emptyHint")} />}
        rowActions={(row) => (
          <>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void retry.run(row.id)}
              disabled={row.status !== "failed" || retry.pending}
              aria-label={t("retryAria")}
              title={t("retry")}
            >
              <RotateCcw className="size-4" aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setSelected(row)} aria-label={t("viewAria")}>
              <Eye className="size-4" aria-hidden />
            </Button>
          </>
        )}
      />

      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent title={t("detail.title")} description={selected?.url} className="md:w-[560px]">
          {selected && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[selected.status]} dot={selected.status === "delivering"}>
                  {t(`status.${selected.status}`)}
                </Badge>
                <Badge variant="muted">{t("attemptsBadge", { n: selected.attempts, max: selected.maxAttempts })}</Badge>
              </div>
              <LogViewer
                lines={detailLines}
                height="max-h-[60dvh]"
                autoScroll={false}
                wrap
                lineTone={(line) => (line.startsWith("!") ? "danger" : line.startsWith("#") ? "muted" : undefined)}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
