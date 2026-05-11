"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Save, Trash2, Play, History, Loader2 } from "lucide-react";
import {
  applyComposeRecipeAction,
  deleteComposeRecipeAction,
  upsertComposeRecipeAction,
} from "@/server/actions/compose";
import type { ComposeRecipeRow, ComposeRecipeVersionRow } from "@/lib/db/schema";

interface InstanceLite {
  id: string;
  name: string | null;
  providerInstanceId: string;
  provider: string;
  region: string;
}

export function ComposeWorkspace({
  recipes,
  initial,
  instances,
}: {
  recipes: ComposeRecipeRow[];
  initial: { recipe: ComposeRecipeRow | null; versions: ComposeRecipeVersionRow[] };
  instances: InstanceLite[];
}) {
  const [list, setList] = useState(recipes);
  const [active, setActive] = useState<ComposeRecipeRow | null>(initial.recipe ?? recipes[0] ?? null);
  const [versions, setVersions] = useState<ComposeRecipeVersionRow[]>(initial.versions);
  const [draftName, setDraftName] = useState(active?.name ?? "new-recipe");
  const [draftDesc, setDraftDesc] = useState(active?.description ?? "");
  const [draftBody, setDraftBody] = useState(active?.body ?? "services:\n  app:\n    image: nginx:alpine\n    ports:\n      - \"80:80\"\n");
  const [draftLoc, setDraftLoc] = useState<"local" | "remote">(active?.buildLocation ?? "remote");
  const [note, setNote] = useState("");
  const [applyTo, setApplyTo] = useState<string>(instances[0]?.id ?? "");
  const [output, setOutput] = useState<string>("");
  const [saving, startSave] = useTransition();
  const [applying, startApply] = useTransition();

  const select = (r: ComposeRecipeRow | null) => {
    setActive(r);
    setDraftName(r?.name ?? "new-recipe");
    setDraftDesc(r?.description ?? "");
    setDraftBody(r?.body ?? "");
    setDraftLoc(r?.buildLocation ?? "remote");
    setOutput("");
    setNote("");
    setVersions([]);
  };

  const save = () =>
    startSave(async () => {
      const res = await upsertComposeRecipeAction({
        id: active?.id,
        name: draftName,
        description: draftDesc,
        body: draftBody,
        buildLocation: draftLoc,
        note,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Save failed");
        return;
      }
      toast.success(active ? "Saved new version" : "Recipe created");
      window.location.reload();
    });

  const remove = () => {
    if (!active) return;
    if (!window.confirm(`Delete recipe ${active.name}?`)) return;
    startSave(async () => {
      const res = await deleteComposeRecipeAction(active.id);
      if (res.ok) {
        setList(list.filter((x) => x.id !== active.id));
        select(null);
        toast.success("Deleted");
      }
    });
  };

  const apply = () => {
    if (!active || !applyTo) return;
    startApply(async () => {
      setOutput("");
      const res = await applyComposeRecipeAction({ recipeId: active.id, instanceId: applyTo });
      setOutput(res.output);
      if (res.ok) toast.success("Compose applied");
      else toast.error(res.error ?? "Apply failed");
    });
  };

  return (
    <div className="grid h-[calc(100vh-6rem)] gap-4 md:grid-cols-[260px_1fr]">
      <aside className="flex flex-col gap-2 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        <button
          onClick={() => select(null)}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
        >
          <Plus className="h-4 w-4" /> New recipe
        </button>
        <div className="my-1 border-t border-[var(--color-border)]" />
        {list.length === 0 && <div className="px-2 py-1 text-xs text-muted">No recipes yet.</div>}
        {list.map((r) => (
          <button
            key={r.id}
            onClick={() => select(r)}
            className={`flex flex-col items-start rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface-muted)] ${active?.id === r.id ? "bg-[var(--color-surface-muted)] font-semibold" : ""}`}
          >
            <span>{r.name}</span>
            {r.description && <span className="text-[10px] text-muted">{r.description}</span>}
          </button>
        ))}
      </aside>

      <section className="flex flex-col gap-2 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <header className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-sm"
            placeholder="recipe name"
          />
          <input
            type="text"
            value={draftDesc ?? ""}
            onChange={(e) => setDraftDesc(e.target.value)}
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs"
            placeholder="description"
          />
          <select
            value={draftLoc}
            onChange={(e) => setDraftLoc(e.target.value as "local" | "remote")}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs"
          >
            <option value="remote">build on VM</option>
            <option value="local">build locally</option>
          </select>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
          </button>
          {active && (
            <button
              type="button"
              onClick={remove}
              className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </header>

        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="version note (optional)"
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs"
        />

        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          spellCheck={false}
          className="flex-1 min-h-[16rem] resize-none rounded border border-[var(--color-border)] bg-[#0b0f17] p-2 font-mono text-[11px] text-slate-200"
        />

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={applyTo}
            onChange={(e) => setApplyTo(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs"
          >
            <option value="">— pick instance —</option>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name ?? i.providerInstanceId} · {i.provider}/{i.region}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={applying || !active || !applyTo}
            onClick={apply}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-emerald-950 disabled:opacity-50"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Apply
          </button>
          {versions.length > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted">
              <History className="h-3 w-3" /> {versions.length} version{versions.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {output && (
          <pre className="max-h-48 overflow-auto rounded border border-[var(--color-border)] bg-[#0b0f17] p-2 font-mono text-[11px] text-slate-200">
            {output}
          </pre>
        )}
      </section>
    </div>
  );
}
