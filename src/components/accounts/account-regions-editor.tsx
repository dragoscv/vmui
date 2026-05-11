"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Globe2, Save, Loader2 } from "lucide-react";
import { regionsFor } from "@/lib/providers/regions";
import { updateAccountRegions } from "@/server/actions/accounts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  accountId: string;
  provider: string;
  defaultRegion: string | null;
  initialRegions: string[] | null;
}

export function AccountRegionsEditor({ accountId, provider, defaultRegion, initialRegions }: Props) {
  const catalog = regionsFor(provider);
  const fallback = defaultRegion ? [defaultRegion] : [];
  const [selected, setSelected] = useState<string[]>(initialRegions ?? fallback);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const isMulti = catalog.length > 1;
  if (!isMulti) return null;

  const toggle = (id: string) => {
    setSaved(false);
    setSelected((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  };

  const save = () =>
    startTransition(async () => {
      await updateAccountRegions(accountId, selected);
      setSaved(true);
      setOpen(false);
    });

  return (
    <div className="mt-3 space-y-2 border-t border-[var(--color-border)] pt-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-fg/80 hover:text-fg"
        >
          <Globe2 className="h-3.5 w-3.5" />
          Regions <span className="text-muted">({selected.length || 1})</span>
          <ChevronDown className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
        </button>
        {saved && !pending && <span className="text-xs text-[var(--color-success)]">Saved</span>}
      </div>

      <div className="flex flex-wrap gap-1">
        {(selected.length ? selected : fallback).slice(0, 6).map((r) => (
          <Badge key={r} variant="info" className="text-[10px]">
            {r}
          </Badge>
        ))}
        {selected.length > 6 && (
          <Badge variant="info" className="text-[10px]">
            +{selected.length - 6}
          </Badge>
        )}
      </div>

      {open && (
        <div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/50 p-2">
          <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto pr-1 text-xs">
            {catalog.map((r) => {
              const on = selected.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggle(r.id)}
                  className={`flex items-center gap-1.5 rounded px-2 py-1 text-left transition ${
                    on
                      ? "bg-[var(--color-primary)]/15 text-fg"
                      : "text-muted hover:bg-white/5 hover:text-fg"
                  }`}
                >
                  <Check
                    className={`h-3 w-3 shrink-0 ${on ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className="truncate" title={r.label}>
                    {r.id}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
