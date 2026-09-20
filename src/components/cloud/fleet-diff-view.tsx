"use client";

import { Button, DataTable, EmptyState, Field, PageSection, Stat, StatGrid, type ColumnDef } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitCompare } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export interface FleetSnapshotOption {
  id: string;
  capturedAt: string;
  count: number;
}

export interface FleetMemberRow {
  name: string | null;
  providerInstanceId: string;
  region: string;
}

export interface FleetChangeRow {
  id: string;
  name: string;
  field: string;
  before: string;
  after: string;
}

export interface FleetDiffData {
  beforeAt: string | null;
  afterAt: string;
  added: FleetMemberRow[];
  removed: FleetMemberRow[];
  changed: FleetChangeRow[];
}

export function FleetDiffView({
  snaps,
  before,
  after,
  diff,
}: {
  snaps: FleetSnapshotOption[];
  before: string | null;
  after: string | null;
  diff: FleetDiffData | null;
}) {
  const t = useTranslations("cloud.fleetDiff");
  const format = useFormatter();
  const router = useRouter();
  const [beforeId, setBeforeId] = useState(before ?? snaps[1]?.id ?? "");
  const [afterId, setAfterId] = useState(after ?? snaps[0]?.id ?? "");

  const snapLabel = (s: FleetSnapshotOption) =>
    t("compare.snapshot", { date: format.dateTime(new Date(s.capturedAt), { dateStyle: "medium", timeStyle: "short" }), count: s.count });

  const columns = useMemo<ColumnDef<FleetChangeRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("changed.columns.vm"),
        cell: ({ row }) => <code className="block max-w-[16rem] truncate font-mono text-xs">{row.original.name}</code>,
      },
      { accessorKey: "field", header: t("changed.columns.field") },
      {
        accessorKey: "before",
        header: t("changed.columns.before"),
        cell: ({ row }) => <code className="block max-w-[14rem] truncate font-mono text-xs text-danger">{row.original.before}</code>,
      },
      {
        accessorKey: "after",
        header: t("changed.columns.after"),
        cell: ({ row }) => <code className="block max-w-[14rem] truncate font-mono text-xs text-success">{row.original.after}</code>,
      },
    ],
    [t],
  );

  if (snaps.length === 0) {
    return <EmptyState icon={<GitCompare />} title={t("empty.title")} description={t("empty.description")} />;
  }

  return (
    <div className="space-y-6">
      {snaps.length >= 2 && (
        <div className="surface flex flex-wrap items-end gap-3 p-4">
          <Field label={t("compare.before")} className="min-w-[14rem] flex-1">
            <Select value={beforeId} onValueChange={setBeforeId}>
              <SelectTrigger aria-label={t("compare.before")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {snaps.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {snapLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("compare.after")} className="min-w-[14rem] flex-1">
            <Select value={afterId} onValueChange={setAfterId}>
              <SelectTrigger aria-label={t("compare.after")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {snaps.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {snapLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button
            variant="secondary"
            disabled={!beforeId || !afterId}
            onClick={() => router.push(`/fleet-diff?before=${encodeURIComponent(beforeId)}&after=${encodeURIComponent(afterId)}`)}
          >
            <GitCompare className="size-4" aria-hidden />
            {t("compare.diff")}
          </Button>
        </div>
      )}

      {!diff ? (
        <EmptyState icon={<GitCompare />} title={t("notFound.title")} description={t("notFound.description")} />
      ) : (
        <>
          <p className="text-sm text-muted">
            {t("range", {
              before: diff.beforeAt ? format.dateTime(new Date(diff.beforeAt), { dateStyle: "medium", timeStyle: "short" }) : t("nothing"),
              after: format.dateTime(new Date(diff.afterAt), { dateStyle: "medium", timeStyle: "short" }),
            })}
          </p>

          <StatGrid cols={3}>
            <Stat label={t("stats.added")} value={diff.added.length} tone="success" />
            <Stat label={t("stats.removed")} value={diff.removed.length} tone="danger" />
            <Stat label={t("stats.changed")} value={diff.changed.length} tone="warning" />
          </StatGrid>

          <PageSection title={t("changed.title")}>
            <DataTable
              columns={columns}
              data={diff.changed}
              getRowId={(r) => r.id}
              dense
              emptyState={<EmptyState compact title={t("changed.empty")} />}
            />
          </PageSection>

          <div className="grid gap-4 lg:grid-cols-2">
            <MemberSection title={t("added.title")} empty={t("added.empty")} items={diff.added} />
            <MemberSection title={t("removed.title")} empty={t("removed.empty")} items={diff.removed} />
          </div>
        </>
      )}
    </div>
  );
}

function MemberSection({ title, empty, items }: { title: string; empty: string; items: FleetMemberRow[] }) {
  return (
    <PageSection title={title}>
      {items.length === 0 ? (
        <EmptyState compact title={empty} />
      ) : (
        <ul className="surface divide-y divide-border font-mono text-xs">
          {items.map((m) => (
            <li key={m.providerInstanceId} className="flex min-h-10 items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{m.name ?? m.providerInstanceId}</span>
              <span className="shrink-0 text-muted">{m.region}</span>
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}
