"use client";

import { Button, DataTable, EmptyState, Field, Input, PageSection, Switch, sortableHeader, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import { deleteAutoTagRuleAction, upsertAutoTagRuleAction } from "@/server/actions/sticky-and-tags";
import { Plus, Tag, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { TagChip } from "./tag-chip";

export interface AutoTagRuleRow {
  id: string;
  namePattern: string;
  tagKey: string;
  tagValue: string;
  priority: number;
  enabled: boolean;
}

async function run(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    return ok();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function AutoTagWorkspace({ rules }: { rules: AutoTagRuleRow[] }) {
  const t = useTranslations("govern.autoTag");
  const confirm = useConfirm();
  const [form, setForm] = React.useState({ namePattern: "", tagKey: "", tagValue: "", priority: 100, enabled: true });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.namePattern.trim() && form.tagKey.trim() && form.tagValue.trim();

  const create = useAction(
    () => run(() => upsertAutoTagRuleAction({ namePattern: form.namePattern.trim(), tagKey: form.tagKey.trim(), tagValue: form.tagValue.trim(), priority: form.priority, enabled: form.enabled })),
    { success: t("toast.created"), onSuccess: () => setForm({ namePattern: "", tagKey: "", tagValue: "", priority: 100, enabled: true }) },
  );
  const toggle = useAction(
    (r: AutoTagRuleRow, enabled: boolean) => run(() => upsertAutoTagRuleAction({ id: r.id, namePattern: r.namePattern, tagKey: r.tagKey, tagValue: r.tagValue, priority: r.priority, enabled })),
    { success: t("toast.toggled") },
  );
  const remove = useAction((r: AutoTagRuleRow) => run(() => deleteAutoTagRuleAction(r.id)), { success: t("toast.deleted") });

  async function onDelete(r: AutoTagRuleRow) {
    const yes = await confirm({ title: t("confirmDelete.title"), description: t("confirmDelete.description"), tone: "danger", confirmText: t("confirmDelete.confirm") });
    if (yes) await remove.run(r);
  }

  const columns = React.useMemo<ColumnDef<AutoTagRuleRow, unknown>[]>(
    () => [
      { accessorKey: "namePattern", header: sortableHeader(t("columns.pattern")), cell: ({ row }) => <code className="font-mono text-xs">{row.original.namePattern}</code> },
      { id: "tag", accessorFn: (r) => `${r.tagKey}=${r.tagValue}`, header: t("columns.tag"), enableSorting: false, cell: ({ row }) => <TagChip tagKey={row.original.tagKey} value={row.original.tagValue} /> },
      { accessorKey: "priority", header: sortableHeader(t("columns.priority")), cell: ({ row }) => <span className="tabular-nums text-fg-muted">{row.original.priority}</span> },
      {
        accessorKey: "enabled",
        header: sortableHeader(t("columns.enabled")),
        cell: ({ row }) => (
          <Switch checked={row.original.enabled} disabled={toggle.pending} onCheckedChange={(v) => void toggle.run(row.original, v)} aria-label={t("toggleLabel", { pattern: row.original.namePattern })} />
        ),
      },
    ],
    [t, toggle],
  );

  return (
    <div className="space-y-4">
      <PageSection title={t("create.title")}>
        <form
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void create.run();
          }}
        >
          <Field label={t("create.pattern")} hint={t("create.patternHint")} className="sm:col-span-2">
            <Input value={form.namePattern} onChange={(e) => set("namePattern", e.target.value)} placeholder={t("create.patternPlaceholder")} className="font-mono" required />
          </Field>
          <Field label={t("create.key")}>
            <Input value={form.tagKey} onChange={(e) => set("tagKey", e.target.value)} placeholder={t("create.keyPlaceholder")} className="font-mono" required />
          </Field>
          <Field label={t("create.value")}>
            <Input value={form.tagValue} onChange={(e) => set("tagValue", e.target.value)} placeholder={t("create.valuePlaceholder")} className="font-mono" required />
          </Field>
          <Field label={t("create.priority")} hint={t("create.priorityHint")}>
            <Input type="number" min={0} max={10000} value={form.priority} onChange={(e) => set("priority", Number(e.target.value) || 0)} className="tabular-nums" />
          </Field>
          <Field label={t("create.enabled")} hint={t("create.enabledHint")} inline className="self-end">
            <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
          </Field>
          <div className="flex items-end justify-end sm:col-span-2">
            <Button type="submit" loading={create.pending} disabled={!valid}>
              <Plus className="size-4" aria-hidden /> {t("create.submit")}
            </Button>
          </div>
        </form>
      </PageSection>

      <PageSection title={t("title")}>
        <DataTable
          columns={columns}
          data={rules}
          dense
          getRowId={(r) => r.id}
          emptyState={<EmptyState compact icon={<Tag />} title={t("empty.title")} description={t("empty.description")} />}
          rowActions={(r) => (
            <Button size="icon" variant="ghost" aria-label={t("delete", { pattern: r.namePattern })} onClick={() => void onDelete(r)} disabled={remove.pending}>
              <Trash2 className="size-4 text-danger" aria-hidden />
            </Button>
          )}
        />
      </PageSection>
    </div>
  );
}
