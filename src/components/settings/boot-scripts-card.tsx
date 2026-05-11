"use client";

import { useState, useTransition } from "react";
import { Loader2, Save, Trash2, Plus, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { BootScriptRow } from "@/lib/db/schema";
import {
  upsertBootScriptAction,
  deleteBootScriptAction,
} from "@/server/actions/boot-scripts";

type Kind = "cloud-init" | "bash" | "powershell";

interface Draft {
  id?: string;
  name: string;
  description: string;
  kind: Kind;
  body: string;
}

function toDraft(row: BootScriptRow): Draft {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    kind: row.kind as Kind,
    body: row.body,
  };
}

export function BootScriptsCard({ initial }: { initial: BootScriptRow[] }) {
  const [rows, setRows] = useState<BootScriptRow[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, start] = useTransition();

  function newDraft() {
    setDraft({ name: "", description: "", kind: "cloud-init", body: "" });
  }

  function save() {
    if (!draft) return;
    start(async () => {
      const r = await upsertBootScriptAction({
        id: draft.id,
        name: draft.name,
        description: draft.description || null,
        kind: draft.kind,
        body: draft.body,
      });
      if (!r.ok) {
        toast.error("Save failed", { description: r.error });
        return;
      }
      toast.success("Boot script saved");
      const id = r.id!;
      const row: BootScriptRow = {
        id,
        name: draft.name,
        description: draft.description || null,
        kind: draft.kind,
        body: draft.body,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setRows((prev) => {
        const exists = prev.findIndex((x) => x.id === id);
        if (exists >= 0) {
          const copy = [...prev];
          copy[exists] = row;
          return copy;
        }
        return [...prev, row];
      });
      setDraft(null);
    });
  }

  function remove(id: string) {
    if (!window.confirm("Delete this boot script?")) return;
    start(async () => {
      const r = await deleteBootScriptAction(id);
      if (r.ok) {
        setRows((prev) => prev.filter((x) => x.id !== id));
        toast.success("Boot script deleted");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="h-4 w-4 text-[var(--color-primary)]" />
          Boot scripts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted">
          User-data scripts passed verbatim to the provider at instance creation. Pick one in the
          create form. vmui never executes them locally.
        </p>

        <ul className="space-y-2">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-[var(--color-border)] p-2 text-xs"
            >
              <Badge variant="info" className="shrink-0 text-[10px]">
                {s.kind}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.name}</div>
                {s.description && <div className="truncate text-[11px] text-muted">{s.description}</div>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setDraft(toDraft(s))}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove(s.id)} disabled={pending}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>

        {!draft && (
          <Button size="sm" variant="secondary" onClick={newDraft}>
            <Plus className="h-3.5 w-3.5" /> New boot script
          </Button>
        )}

        {draft && (
          <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3">
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Install Docker"
              className="text-xs"
            />
            <Input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="One-line description (optional)"
              className="text-xs"
            />
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
            >
              <option value="cloud-init">cloud-init</option>
              <option value="bash">bash</option>
              <option value="powershell">powershell</option>
            </select>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={10}
              placeholder={"#cloud-config\npackage_update: true\n..."}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono text-[11px]"
              spellCheck={false}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={pending || !draft.name.trim() || !draft.body.trim()}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
