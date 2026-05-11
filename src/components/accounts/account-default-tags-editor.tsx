"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Save, Tag, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { updateAccountDefaultTags, backfillAccountDefaultTags } from "@/server/actions/accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  accountId: string;
  /** JSON string from cloud_accounts.default_tags, or null. */
  initial: string | null;
}

interface Row {
  key: string;
  value: string;
}

function parseInitial(json: string | null): Row[] {
  if (!json) return [];
  try {
    const obj = JSON.parse(json) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
    return Object.entries(obj as Record<string, unknown>).map(([k, v]) => ({
      key: String(k),
      value: typeof v === "string" ? v : String(v ?? ""),
    }));
  } catch {
    return [];
  }
}

export function AccountDefaultTagsEditor({ accountId, initial }: Props) {
  const [rows, setRows] = useState<Row[]>(() => parseInitial(initial));
  const [pending, start] = useTransition();
  const [backfilling, startBackfill] = useTransition();

  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setRows((prev) => [...prev, { key: "", value: "" }]);

  const save = () => {
    const cleaned = rows
      .map((r) => ({ key: r.key.trim(), value: r.value }))
      .filter((r) => r.key.length > 0);
    start(async () => {
      const r = await updateAccountDefaultTags(accountId, cleaned);
      if (r.ok) toast.success("Default tags saved");
      else toast.error("Save failed", { description: r.error });
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Tag className="h-3.5 w-3.5" />
        Applied to every new instance created for this account. Existing instances are not touched.
      </div>
      {rows.length === 0 && (
        <p className="text-xs text-muted">No default tags. Add one to start.</p>
      )}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              placeholder="key"
              value={row.key}
              onChange={(e) => update(i, { key: e.target.value })}
              className="max-w-44 font-mono text-xs"
              maxLength={64}
            />
            <span className="text-muted">=</span>
            <Input
              placeholder="value"
              value={row.value}
              onChange={(e) => update(i, { value: e.target.value })}
              className="font-mono text-xs"
              maxLength={256}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted hover:text-[var(--color-danger)]"
              onClick={() => remove(i)}
              type="button"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
          Add tag
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={backfilling || rows.length === 0}
          onClick={() =>
            startBackfill(async () => {
              const r = await backfillAccountDefaultTags(accountId);
              if (r.ok) toast.success(`Back-filled ${r.updated} instance${r.updated === 1 ? "" : "s"}`);
              else
                toast.error("Back-fill incomplete", {
                  description: r.error ?? `${r.updated} ok / ${r.failed.length} failed`,
                });
            })
          }
          title="Apply current default tags to every existing instance in this account"
        >
          {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Back-fill existing
        </Button>
      </div>
    </div>
  );
}
