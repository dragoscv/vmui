"use client";

import { useState, useTransition } from "react";
import { Loader2, Save, Plus, X, Tag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { updateRequiredTagsAction } from "@/server/actions/account-policy";

interface Props {
  accountId: string;
  initial: string | null;
}

function parseInitial(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return arr.filter((s): s is string => typeof s === "string");
  } catch {
    /* ignore */
  }
  return [];
}

export function RequiredTagsEditor({ accountId, initial }: Props) {
  const [keys, setKeys] = useState<string[]>(parseInitial(initial));
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();

  function addKey() {
    const k = draft.trim();
    if (!k || keys.includes(k)) return;
    setKeys((p) => [...p, k]);
    setDraft("");
  }

  function save() {
    start(async () => {
      const r = await updateRequiredTagsAction({ accountId, keys });
      if (r.ok) toast.success(keys.length === 0 ? "Required tags cleared" : `Saved ${keys.length} required tag${keys.length === 1 ? "" : "s"}`);
      else toast.error("Save failed", { description: r.error });
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Tag className="h-3.5 w-3.5" />
        Compliance flags any instance missing these keys.
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {keys.map((k) => (
          <Badge key={k} variant="info" className="gap-1">
            {k}
            <button
              type="button"
              onClick={() => setKeys((p) => p.filter((x) => x !== k))}
              aria-label={`Remove ${k}`}
              className="rounded p-0.5 hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {keys.length === 0 && <span className="text-xs text-muted">No required tags.</span>}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="cost-center"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addKey();
            }
          }}
          className="max-w-48 text-xs"
        />
        <Button size="sm" variant="ghost" onClick={addKey}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}
