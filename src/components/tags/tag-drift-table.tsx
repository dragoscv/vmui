"use client";

import { Badge, Button, DataTable, EmptyState, Stat, StatGrid, sortableHeader, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import { pushLocalTagsToProviderAction } from "@/server/actions/drift-remediate";
import { CheckCircle2, GitCompareArrows, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import * as React from "react";
import { TagChip } from "./tag-chip";

export interface DriftRow {
  id: string;
  name: string;
  provider: string;
  region: string;
  onlyProvider: { key: string; value: string }[];
  onlyLocal: { key: string; value: string }[];
  conflicting: { key: string; provider: string; local: string }[];
}

export function TagDriftTable({ drifts }: { drifts: DriftRow[] }) {
  const t = useTranslations("govern.tagDrift");
  const confirm = useConfirm();
  const [detail, setDetail] = React.useState<DriftRow | null>(null);

  const push = useAction(
    async (row: DriftRow): Promise<ActionResult> => {
      const r = await pushLocalTagsToProviderAction({ instanceId: row.id });
      return r.ok ? ok() : { ok: false, error: r.error };
    },
    { success: t("toast.pushed") },
  );

  async function onPush(row: DriftRow) {
    const yes = await confirm({ title: t("confirmPush.title", { name: row.name }), description: t("confirmPush.description"), tone: "warning", confirmText: t("confirmPush.confirm") });
    if (yes) await push.run(row);
  }

  const conflicts = drifts.reduce((a, d) => a + d.conflicting.length, 0);
  const onlyLocal = drifts.reduce((a, d) => a + d.onlyLocal.length, 0);
  const onlyProvider = drifts.reduce((a, d) => a + d.onlyProvider.length, 0);

  const columns = React.useMemo<ColumnDef<DriftRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: sortableHeader(t("columns.instance")),
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link href={`/instances/${encodeURIComponent(row.original.id)}`} className="block truncate font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={(e) => e.stopPropagation()}>
              {row.original.name}
            </Link>
            <span className="block truncate text-xs text-fg-muted">{row.original.region}</span>
          </div>
        ),
      },
      { accessorKey: "provider", header: sortableHeader(t("columns.provider")), cell: ({ row }) => <Badge variant="muted">{row.original.provider}</Badge> },
      {
        id: "onlyProvider",
        accessorFn: (r) => r.onlyProvider.length,
        header: sortableHeader(t("columns.onlyProvider")),
        cell: ({ row }) => <Badge variant={row.original.onlyProvider.length ? "warning" : "muted"}>{row.original.onlyProvider.length}</Badge>,
      },
      {
        id: "onlyLocal",
        accessorFn: (r) => r.onlyLocal.length,
        header: sortableHeader(t("columns.onlyLocal")),
        cell: ({ row }) => <Badge variant={row.original.onlyLocal.length ? "info" : "muted"}>{row.original.onlyLocal.length}</Badge>,
      },
      {
        id: "conflicting",
        accessorFn: (r) => r.conflicting.length,
        header: sortableHeader(t("columns.conflicting")),
        cell: ({ row }) => <Badge variant={row.original.conflicting.length ? "danger" : "muted"}>{row.original.conflicting.length}</Badge>,
      },
    ],
    [t],
  );

  return (
    <>
      <StatGrid cols={4}>
        <Stat label={t("stats.drifting")} value={drifts.length} tone={drifts.length ? "warning" : "success"} icon={<GitCompareArrows />} />
        <Stat label={t("stats.conflicts")} value={conflicts} tone={conflicts ? "danger" : "default"} />
        <Stat label={t("stats.onlyLocal")} value={onlyLocal} tone={onlyLocal ? "info" : "default"} />
        <Stat label={t("stats.onlyProvider")} value={onlyProvider} tone={onlyProvider ? "warning" : "default"} />
      </StatGrid>

      <DataTable
        columns={columns}
        data={drifts}
        searchable={drifts.length > 8}
        getRowId={(r) => r.id}
        onRowClick={setDetail}
        emptyState={<EmptyState icon={<CheckCircle2 />} title={t("none.title")} description={t("none.description")} />}
        rowActions={(row) => (
          <Button size="sm" variant="outline" loading={push.pending} aria-label={t("pushLabel", { name: row.name })} onClick={() => void onPush(row)}>
            <Upload className="size-3.5" aria-hidden /> {t("push")}
          </Button>
        )}
      />

      <Sheet open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        {detail && (
          <SheetContent title={detail.name} description={`${detail.provider} · ${detail.region}`}>
            <div className="space-y-5 text-sm">
              <DriftGroup title={t("sheet.onlyProvider")} empty={t("sheet.none")} items={detail.onlyProvider.map((i) => ({ key: i.key, value: i.value }))} emptyValue={t("sheet.empty")} />
              <DriftGroup title={t("sheet.onlyLocal")} empty={t("sheet.none")} items={detail.onlyLocal.map((i) => ({ key: i.key, value: i.value }))} emptyValue={t("sheet.empty")} />
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{t("sheet.conflicting")}</h3>
                {detail.conflicting.length === 0 ? (
                  <p className="text-fg-muted">{t("sheet.none")}</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.conflicting.map((c) => (
                      <li key={c.key} className="rounded-[var(--radius-md)] border border-[color-mix(in_oklch,var(--color-danger)_45%,var(--color-border))] bg-[color-mix(in_oklch,var(--color-danger)_8%,transparent)] p-2">
                        <TagChip tagKey={c.key} />
                        <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-xs">
                          <dt className="text-fg-muted">{t("sheet.providerValue")}</dt>
                          <dd className="truncate text-warning">{c.provider || t("sheet.empty")}</dd>
                          <dt className="text-fg-muted">{t("sheet.localValue")}</dt>
                          <dd className="truncate text-info">{c.local || t("sheet.empty")}</dd>
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <Button loading={push.pending} onClick={() => void onPush(detail)} className="w-full">
                <Upload className="size-4" aria-hidden /> {t("push")}
              </Button>
            </div>
          </SheetContent>
        )}
      </Sheet>
    </>
  );
}

function DriftGroup({ title, items, empty, emptyValue }: { title: string; items: { key: string; value: string }[]; empty: string; emptyValue: string }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>
      {items.length === 0 ? (
        <p className="text-fg-muted">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((i) => (
            <li key={i.key}>
              <TagChip tagKey={i.key} value={i.value || emptyValue} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
