"use client";

import { Button, DataTable, EmptyState, PageSection, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { forgetKnownHostAction, type KnownHostRow } from "@/server/actions/known-hosts";
import { ShieldCheck, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toResult } from "./adapt";
import { RelativeTime } from "./relative-time";

export function KnownHostsCard({ initial }: { initial: KnownHostRow[] }) {
  const t = useTranslations("settings.access.knownHosts");
  const format = useFormatter();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const confirm = useConfirm();

  const forget = useAction(
    async (row: KnownHostRow) => {
      setBusy(row.id);
      const r = toResult(await forgetKnownHostAction({ host: row.host, port: row.port }));
      setBusy(null);
      if (r.ok) setRows((prev) => prev.filter((x) => x.id !== row.id));
      return r;
    },
    { success: t("forgotten"), refresh: false },
  );

  async function onForget(row: KnownHostRow) {
    const ok = await confirm({
      title: t("confirmForget", { host: `${row.host}:${row.port}` }),
      description: t("confirmForgetHint"),
      tone: "warning",
      confirmText: t("forget"),
    });
    if (ok) await forget.run(row);
  }

  const columns = useMemo<ColumnDef<KnownHostRow, unknown>[]>(
    () => [
      {
        accessorFn: (r) => `${r.host}:${r.port}`,
        id: "host",
        header: t("columns.host"),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.host}
            <span className="text-fg-muted">:{row.original.port}</span>
          </span>
        ),
      },
      {
        accessorKey: "fingerprintSha256",
        header: t("columns.fingerprint"),
        enableSorting: false,
        cell: ({ row }) => (
          <code className="block max-w-[14rem] truncate font-mono text-xs text-fg-muted" title={row.original.fingerprintSha256}>
            sha256:{row.original.fingerprintSha256}
          </code>
        ),
      },
      {
        accessorKey: "firstSeenAt",
        header: t("columns.firstSeen"),
        cell: ({ row }) => <span className="whitespace-nowrap text-fg-muted">{format.dateTime(new Date(row.original.firstSeenAt), { dateStyle: "medium" })}</span>,
      },
      {
        accessorKey: "lastSeenAt",
        header: t("columns.lastSeen"),
        cell: ({ row }) => <RelativeTime date={row.original.lastSeenAt} className="whitespace-nowrap text-fg-muted" />,
      },
    ],
    [t, format],
  );

  return (
    <PageSection title={t("title")} description={t("description")}>
      <DataTable
        columns={columns}
        data={rows}
        dense
        searchable={rows.length > 5}
        getRowId={(r) => r.id}
        emptyState={<EmptyState compact icon={<ShieldCheck />} title={t("empty")} description={t("emptyHint")} />}
        rowActions={(r) => (
          <Button variant="ghost" size="icon" onClick={() => void onForget(r)} loading={forget.pending && busy === r.id} aria-label={t("forget")}>
            <Trash2 className="size-4 text-danger" aria-hidden />
          </Button>
        )}
      />
    </PageSection>
  );
}
