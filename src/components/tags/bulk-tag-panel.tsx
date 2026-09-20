"use client";

import { Badge, Button, Checkbox, DataTable, EmptyState, Field, Input, PageSection, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bulkApplyTags } from "@/server/actions/bulk-tags";
import { Plus, Server, Tag, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { TagChip } from "./tag-chip";

interface Row {
  id: string;
  name: string | null;
  displayName: string | null;
  provider: string;
  region: string;
  state: string;
  instanceType: string | null;
}

const ALL = "__all__";

export function BulkTagPanel({ rows }: { rows: Row[] }) {
  const t = useTranslations("govern.tags.bulk");
  const confirm = useConfirm();
  const router = useRouter();
  const [providerFilter, setProviderFilter] = React.useState<string>(ALL);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [tags, setTags] = React.useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [pending, start] = React.useTransition();

  const providers = React.useMemo(() => Array.from(new Set(rows.map((r) => r.provider))).sort(), [rows]);
  const filtered = React.useMemo(() => (providerFilter === ALL ? rows : rows.filter((r) => r.provider === providerFilter)), [rows, providerFilter]);
  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of filtered) if (allChecked) next.delete(r.id);
        else next.add(r.id);
      return next;
    });

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: () => <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label={t("selectAll")} />,
        cell: ({ row }) => (
          <Checkbox
            checked={selected.has(row.original.id)}
            onCheckedChange={() => toggle(row.original.id)}
            aria-label={t("select", { name: row.original.displayName ?? row.original.name ?? row.original.id })}
          />
        ),
      },
      {
        id: "name",
        accessorFn: (r) => r.displayName ?? r.name ?? r.id,
        header: t("columns.name"),
        cell: ({ row }) => <span className="block truncate font-medium">{row.original.displayName ?? row.original.name ?? row.original.id}</span>,
      },
      { accessorKey: "provider", header: t("columns.provider"), cell: ({ row }) => <Badge variant="muted">{row.original.provider}</Badge> },
      { accessorKey: "region", header: t("columns.region"), cell: ({ row }) => <span className="text-fg-muted">{row.original.region}</span> },
      { accessorKey: "instanceType", header: t("columns.type"), cell: ({ row }) => <code className="font-mono text-xs text-fg-muted">{row.original.instanceType ?? "—"}</code> },
      { accessorKey: "state", header: t("columns.state"), cell: ({ row }) => <span className="text-fg-muted">{row.original.state}</span> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toggle/toggleAll are stable enough; rerender is driven by `selected`
    [t, selected, allChecked],
  );

  const apply = async () => {
    const tagMap: Record<string, string> = {};
    for (const tag of tags) {
      const k = tag.key.trim();
      if (k) tagMap[k] = tag.value.trim();
    }
    if (Object.keys(tagMap).length === 0) return toast.error(t("toast.noTags"));
    if (selected.size === 0) return toast.error(t("toast.noTargets"));
    const yes = await confirm({
      title: t("confirm.title", { tags: Object.keys(tagMap).length, vms: selected.size }),
      description: t("confirm.description"),
      tone: "warning",
      confirmText: t("confirm.confirm"),
    });
    if (!yes) return;
    start(async () => {
      const res = await bulkApplyTags({ instanceIds: Array.from(selected), tags: tagMap });
      if (res.failed.length === 0) toast.success(t("toast.success", { count: res.ok }));
      else toast.error(t("toast.partial", { ok: res.ok, failed: res.failed.length, error: res.failed[0]?.error ?? "" }));
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <PageSection title={t("tagsTitle")} description={t("description")}>
        <div className="space-y-2">
          {tags.map((tag, idx) => (
            <div key={idx} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <Field label={t("key")}>
                <Input value={tag.key} placeholder={t("keyPlaceholder")} onChange={(e) => setTags((prev) => prev.map((p, i) => (i === idx ? { ...p, key: e.target.value } : p)))} className="font-mono" />
              </Field>
              <Field label={t("value")}>
                <Input value={tag.value} placeholder={t("valuePlaceholder")} onChange={(e) => setTags((prev) => prev.map((p, i) => (i === idx ? { ...p, value: e.target.value } : p)))} className="font-mono" />
              </Field>
              <Button variant="ghost" size="icon" aria-label={t("removeTag")} disabled={tags.length === 1} onClick={() => setTags((prev) => prev.filter((_, i) => i !== idx))}>
                <Trash2 className="size-4 text-danger" aria-hidden />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setTags((prev) => [...prev, { key: "", value: "" }])}>
              <Plus className="size-4" aria-hidden /> {t("addTag")}
            </Button>
            {tags.filter((tag) => tag.key.trim()).map((tag) => (
              <TagChip key={tag.key} tagKey={tag.key.trim()} value={tag.value.trim()} />
            ))}
          </div>
        </div>
      </PageSection>

      <PageSection
        title={t("targetsTitle")}
        action={
          <>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger aria-label={t("provider")} className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("allProviders")}</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="info">{t("selected", { count: selected.size })}</Badge>
          </>
        }
      >
        <div className="space-y-3">
          <DataTable
            columns={columns}
            data={filtered}
            dense
            searchable
            getRowId={(r) => r.id}
            onRowClick={(r) => toggle(r.id)}
            emptyState={<EmptyState compact icon={<Server />} title={t("empty.title")} description={t("empty.description")} />}
          />
          <div className="flex justify-end">
            <Button loading={pending} disabled={selected.size === 0} onClick={() => void apply()}>
              <Tag className="size-4" aria-hidden /> {t("apply", { count: selected.size })}
            </Button>
          </div>
        </div>
      </PageSection>
    </div>
  );
}
