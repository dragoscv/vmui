"use client";

import { Badge, Button, DataTable, EmptyState, Field, Input, PageSection, Stat, StatGrid, Switch, sortableHeader, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import type { PolicyViolation } from "@/lib/tag-policy";
import { deleteTagPolicyAction, upsertTagPolicyAction } from "@/server/actions/extras-2";
import { CheckCircle2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import * as React from "react";
import { TagChip } from "./tag-chip";

export interface PolicyRow {
  id: string;
  name: string;
  condition: string;
  requireKeys: string[];
  enabled: boolean;
}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult> {
  try {
    await fn();
    return ok();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function TagPoliciesWorkspace({ policies, violations }: { policies: PolicyRow[]; violations: PolicyViolation[] }) {
  const t = useTranslations("govern.tagPolicies");
  const confirm = useConfirm();
  const [form, setForm] = React.useState({ name: "", condition: "", requireKeys: "", enabled: true });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const keys = form.requireKeys.split(",").map((s) => s.trim()).filter(Boolean);

  const create = useAction(
    () => run(() => upsertTagPolicyAction({ name: form.name.trim(), condition: form.condition.trim(), requireKeys: keys, enabled: form.enabled })),
    { success: t("toast.created"), onSuccess: () => setForm({ name: "", condition: "", requireKeys: "", enabled: true }) },
  );
  const toggle = useAction(
    (p: PolicyRow, enabled: boolean) => run(() => upsertTagPolicyAction({ id: p.id, name: p.name, condition: p.condition, requireKeys: p.requireKeys, enabled })),
    { success: t("toast.toggled") },
  );
  const remove = useAction((p: PolicyRow) => run(() => deleteTagPolicyAction(p.id)), { success: t("toast.deleted") });

  async function onDelete(p: PolicyRow) {
    const yes = await confirm({ title: t("confirmDelete.title", { name: p.name }), description: t("confirmDelete.description"), tone: "danger", confirmText: t("confirmDelete.confirm") });
    if (yes) await remove.run(p);
  }

  const policyColumns = React.useMemo<ColumnDef<PolicyRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: sortableHeader(t("columns.name")), cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { accessorKey: "condition", header: t("columns.condition"), enableSorting: false, cell: ({ row }) => <code className="block max-w-[24rem] truncate font-mono text-xs">{row.original.condition}</code> },
      {
        id: "required",
        header: t("columns.required"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.requireKeys.map((k) => (
              <TagChip key={k} tagKey={k} />
            ))}
          </span>
        ),
      },
      {
        accessorKey: "enabled",
        header: sortableHeader(t("columns.enabled")),
        cell: ({ row }) => (
          <Switch checked={row.original.enabled} disabled={toggle.pending} onCheckedChange={(v) => void toggle.run(row.original, v)} aria-label={t("toggleLabel", { name: row.original.name })} />
        ),
      },
    ],
    [t, toggle],
  );

  const violationColumns = React.useMemo<ColumnDef<PolicyViolation, unknown>[]>(
    () => [
      {
        accessorKey: "instanceName",
        header: sortableHeader(t("violations.columns.instance")),
        cell: ({ row }) => (
          <Link href={`/instances/${encodeURIComponent(row.original.instanceId)}`} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {row.original.instanceName}
          </Link>
        ),
      },
      { accessorKey: "policyName", header: sortableHeader(t("violations.columns.policy")), cell: ({ row }) => <span className="text-fg-muted">{row.original.policyName}</span> },
      {
        id: "missing",
        header: t("violations.columns.missing"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.missingKeys.map((k) => (
              <TagChip key={k} tagKey={k} className="border-[color-mix(in_oklch,var(--color-danger)_45%,var(--color-border))]" />
            ))}
          </span>
        ),
      },
    ],
    [t],
  );

  const enabledCount = policies.filter((p) => p.enabled).length;

  return (
    <div className="space-y-4">
      <StatGrid cols={3}>
        <Stat label={t("stats.policies")} value={policies.length} />
        <Stat label={t("stats.enabled")} value={enabledCount} tone={enabledCount > 0 ? "info" : "default"} />
        <Stat label={t("stats.violations")} value={violations.length} tone={violations.length > 0 ? "danger" : "success"} icon={<ShieldAlert />} />
      </StatGrid>

      <PageSection title={t("create.title")} description={t("dslHint")}>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name.trim() && form.condition.trim() && keys.length) void create.run();
          }}
        >
          <Field label={t("create.name")}>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("create.namePlaceholder")} required />
          </Field>
          <Field label={t("create.requiredKeys")} hint={t("create.requiredKeysHint")}>
            <Input value={form.requireKeys} onChange={(e) => set("requireKeys", e.target.value)} placeholder={t("create.requiredKeysPlaceholder")} className="font-mono" required />
          </Field>
          <Field label={t("create.condition")} className="sm:col-span-2">
            <Input value={form.condition} onChange={(e) => set("condition", e.target.value)} placeholder={t("dslExample")} className="font-mono" required />
          </Field>
          <Field label={t("create.enabled")} hint={t("create.enabledHint")} inline>
            <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
          </Field>
          <div className="flex items-end justify-end">
            <Button type="submit" loading={create.pending} disabled={!form.name.trim() || !form.condition.trim() || keys.length === 0}>
              <Plus className="size-4" aria-hidden /> {t("create.submit")}
            </Button>
          </div>
        </form>
      </PageSection>

      <PageSection title={t("title")}>
        <DataTable
          columns={policyColumns}
          data={policies}
          dense
          getRowId={(p) => p.id}
          emptyState={<EmptyState compact icon={<ShieldAlert />} title={t("empty.title")} description={t("empty.description")} />}
          rowActions={(p) => (
            <Button size="icon" variant="ghost" aria-label={t("delete", { name: p.name })} onClick={() => void onDelete(p)} disabled={remove.pending}>
              <Trash2 className="size-4 text-danger" aria-hidden />
            </Button>
          )}
        />
      </PageSection>

      <PageSection title={t("violations.title")} description={t("violations.description")} action={<Badge variant={violations.length ? "danger" : "success"}>{violations.length}</Badge>}>
        <DataTable
          columns={violationColumns}
          data={violations}
          dense
          searchable={violations.length > 8}
          getRowId={(v) => `${v.policyId}:${v.instanceId}`}
          emptyState={<EmptyState compact icon={<CheckCircle2 />} title={t("violations.none.title")} description={t("violations.none.description")} />}
        />
      </PageSection>
    </div>
  );
}
