"use client";

import { LogViewer } from "@/components/ops/log-viewer";
import { RelativeTime } from "@/components/settings/relative-time";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageSection,
  Textarea,
  ToggleGroup,
  sortableHeader,
  type ColumnDef,
} from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import { err, ok, type ActionResult } from "@/lib/action-result";
import type { ComposeRecipeRow, ComposeRecipeVersionRow } from "@/lib/db/schema";
import {
  applyComposeRecipeAction,
  deleteComposeRecipeAction,
  upsertComposeRecipeAction,
} from "@/server/actions/compose";
import { FileStack, History, Play, Plus, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
  region: string;
}

const BLANK_BODY = 'services:\n  app:\n    image: nginx:alpine\n    ports:\n      - "80:80"\n';

export function ComposeWorkspace({
  recipes,
  initial,
  instances,
}: {
  recipes: ComposeRecipeRow[];
  initial: { recipe: ComposeRecipeRow | null; versions: ComposeRecipeVersionRow[] };
  instances: InstanceLite[];
}) {
  const t = useTranslations("ops.compose");
  const confirm = useConfirm();

  const [list, setList] = useState(recipes);
  const [active, setActive] = useState<ComposeRecipeRow | null>(initial.recipe ?? recipes[0] ?? null);
  const [versions, setVersions] = useState<ComposeRecipeVersionRow[]>(initial.versions);
  const [draftName, setDraftName] = useState(active?.name ?? "new-recipe");
  const [draftDesc, setDraftDesc] = useState(active?.description ?? "");
  const [draftBody, setDraftBody] = useState(active?.body ?? BLANK_BODY);
  const [draftLoc, setDraftLoc] = useState<"local" | "remote">(active?.buildLocation ?? "remote");
  const [note, setNote] = useState("");
  const [applyTo, setApplyTo] = useState<string>(instances[0]?.id ?? "");
  const [output, setOutput] = useState<string>("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const select = (r: ComposeRecipeRow | null) => {
    setActive(r);
    setDraftName(r?.name ?? "new-recipe");
    setDraftDesc(r?.description ?? "");
    setDraftBody(r?.body ?? BLANK_BODY);
    setDraftLoc(r?.buildLocation ?? "remote");
    setOutput("");
    setNote("");
    setVersions([]);
  };

  const save = useAction(
    async (): Promise<ActionResult> => {
      const res = await upsertComposeRecipeAction({
        id: active?.id,
        name: draftName,
        description: draftDesc,
        body: draftBody,
        buildLocation: draftLoc,
        note,
      });
      if (!res.ok) return err(res.error ?? "common.error");
      window.location.reload();
      return ok();
    },
    { success: t("saved"), refresh: false },
  );

  const remove = useAction(
    async (recipe: ComposeRecipeRow): Promise<ActionResult> => {
      const res = await deleteComposeRecipeAction(recipe.id);
      if (!res.ok) return err("common.error");
      setList((prev) => prev.filter((x) => x.id !== recipe.id));
      select(null);
      return ok();
    },
    { success: t("deleted"), refresh: false },
  );

  const apply = useAction(
    async (recipeId: string, instanceId: string): Promise<ActionResult> => {
      setOutput("");
      const res = await applyComposeRecipeAction({ recipeId, instanceId });
      setOutput(res.output);
      if (!res.ok) return err(res.error ?? "common.error");
      return ok();
    },
    { success: t("applied"), refresh: false },
  );

  async function onDelete() {
    if (!active) return;
    const confirmed = await confirm({
      title: t("confirmDelete.title", { name: active.name }),
      description: t("confirmDelete.description"),
      tone: "danger",
      confirmText: t("confirmDelete.confirm"),
      requireText: active.name,
    });
    if (confirmed) await remove.run(active);
  }

  async function onApply() {
    if (!active || !applyTo) return;
    const target = instances.find((i) => i.id === applyTo);
    const confirmed = await confirm({
      title: t("confirmApply.title", { name: active.name }),
      description: t("confirmApply.description", { target: target ? (target.name ?? target.providerInstanceId) : applyTo }),
      tone: "warning",
      confirmText: t("apply"),
    });
    if (confirmed) await apply.run(active.id, applyTo);
  }

  const columns = useMemo<ColumnDef<ComposeRecipeRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: sortableHeader(t("columns.name")),
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="block truncate font-medium">{row.original.name}</span>
            {row.original.description && <span className="block truncate text-xs text-fg-muted">{row.original.description}</span>}
          </span>
        ),
      },
      {
        accessorKey: "buildLocation",
        header: t("columns.buildLocation"),
        cell: ({ row }) => (
          <Badge variant={row.original.buildLocation === "remote" ? "info" : "muted"}>
            {row.original.buildLocation === "remote" ? t("location.remote") : t("location.local")}
          </Badge>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: sortableHeader(t("columns.updated")),
        cell: ({ row }) => <RelativeTime date={row.original.updatedAt} className="whitespace-nowrap text-xs text-fg-muted" />,
      },
    ],
    [t],
  );

  return (
    <>
      <PageSection
        title={t("stacks.title")}
        description={t("stacks.description")}
        action={
          <Button variant="secondary" size="sm" onClick={() => select(null)}>
            <Plus className="size-4" aria-hidden /> {t("newStack")}
          </Button>
        }
      >
        <DataTable
          columns={columns}
          data={list}
          dense
          searchable={list.length > 5}
          getRowId={(r) => r.id}
          onRowClick={(r) => select(r)}
          emptyState={
            <EmptyState
              compact
              icon={<FileStack />}
              title={t("stacks.empty")}
              description={t("stacks.emptyHint")}
              action={
                <Button size="sm" onClick={() => select(null)}>
                  <Plus className="size-4" aria-hidden /> {t("newStack")}
                </Button>
              }
            />
          }
          rowActions={(r) => (
            <Button variant="ghost" size="sm" onClick={() => select(r)}>
              {t("stacks.editAction")}
            </Button>
          )}
        />
      </PageSection>

      <PageSection
        title={active ? t("editor.titleEdit", { name: active.name }) : t("editor.titleNew")}
        description={t("editor.description")}
        action={
          <>
            {versions.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                <History className="size-4" aria-hidden /> {t("history.count", { count: versions.length })}
              </Button>
            )}
            <Button size="sm" loading={save.pending} onClick={() => void save.run()}>
              <Save className="size-4" aria-hidden /> {t("save")}
            </Button>
            {active && (
              <Button variant="ghost" size="icon" aria-label={t("confirmDelete.confirm")} loading={remove.pending} onClick={() => void onDelete()}>
                <Trash2 className="size-4 text-danger" aria-hidden />
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label={t("fields.name")}>
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder={t("fields.namePlaceholder")} />
            </Field>
            <Field label={t("fields.description")} className="xl:col-span-2">
              <Input value={draftDesc ?? ""} onChange={(e) => setDraftDesc(e.target.value)} placeholder={t("fields.descriptionPlaceholder")} />
            </Field>
            <Field label={t("fields.buildLocation")}>
              <ToggleGroup
                value={draftLoc}
                onValueChange={setDraftLoc}
                aria-label={t("fields.buildLocation")}
                options={[
                  { value: "remote", label: t("location.remote") },
                  { value: "local", label: t("location.local") },
                ]}
              />
            </Field>
          </div>

          <Field label={t("fields.note")} hint={t("fields.noteHint")}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("fields.notePlaceholder")} />
          </Field>

          <Field label={t("fields.yaml")}>
            <Textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              spellCheck={false}
              rows={18}
              aria-label={t("fields.yaml")}
              className="min-h-[18rem] resize-y font-mono text-xs"
            />
          </Field>

          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("fields.applyTo")} className="w-full sm:w-72">
              <Select value={applyTo} onValueChange={setApplyTo}>
                <SelectTrigger aria-label={t("fields.applyTo")}>
                  <SelectValue placeholder={t("fields.applyToPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name ?? i.providerInstanceId} · {i.provider}/{i.region}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button loading={apply.pending} disabled={!active || !applyTo} onClick={() => void onApply()}>
              <Play className="size-4" aria-hidden /> {t("apply")}
            </Button>
          </div>

          {(output || apply.pending) && (
            <LogViewer
              title={t("output.title")}
              text={output}
              loading={apply.pending && !output}
              emptyLabel={t("output.empty")}
              height="max-h-72"
              wrap
              lineTone={(line) => (/error|fatal|cannot/i.test(line) ? "danger" : /warn/i.test(line) ? "warning" : undefined)}
            />
          )}
        </div>
      </PageSection>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent title={t("history.title")} description={t("history.description")}>
          <ol className="space-y-3">
            {versions.map((v) => (
              <li key={v.id} className="rounded-[var(--radius-lg)] border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="info">v{v.version}</Badge>
                  <RelativeTime date={v.createdAt} className="text-xs text-fg-muted" />
                </div>
                {v.note && <p className="mt-1 text-xs text-muted">{v.note}</p>}
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setDraftBody(v.body)}>
                  {t("history.load")}
                </Button>
              </li>
            ))}
          </ol>
        </SheetContent>
      </Sheet>
    </>
  );
}
