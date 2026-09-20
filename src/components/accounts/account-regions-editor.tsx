"use client";

import { toResult } from "@/components/settings/adapt";
import { Badge, Button } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { regionsFor } from "@/lib/providers/regions";
import { cn } from "@/lib/utils";
import { updateAccountRegions } from "@/server/actions/accounts";
import { Check, ChevronDown, Globe2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface Props {
  accountId: string;
  provider: string;
  defaultRegion: string | null;
  initialRegions: string[] | null;
}

export function AccountRegionsEditor({ accountId, provider, defaultRegion, initialRegions }: Props) {
  const t = useTranslations("cloud.accountDetail");
  const tc = useTranslations("common");
  const catalog = regionsFor(provider);
  const fallback = defaultRegion ? [defaultRegion] : [];
  const [selected, setSelected] = useState<string[]>(initialRegions ?? fallback);
  const [open, setOpen] = useState(false);

  const save = useAction(async (next: string[]) => toResult(await updateAccountRegions(accountId, next)), {
    success: t("regions.saved"),
    onSuccess: () => setOpen(false),
  });

  if (catalog.length <= 1) return null;

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  const shown = selected.length ? selected : fallback;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-md)] text-xs font-medium text-fg hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Globe2 className="size-3.5" aria-hidden />
        {t("regions.selected", { count: shown.length })}
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      <div className="flex flex-wrap gap-1">
        {shown.slice(0, 6).map((r) => (
          <Badge key={r} variant="muted">
            {r}
          </Badge>
        ))}
        {shown.length > 6 && <Badge variant="muted">{t("regions.more", { count: shown.length - 6 })}</Badge>}
      </div>

      {open && (
        <div className="space-y-2 rounded-[var(--radius-md)] border border-border bg-surface-muted p-2">
          <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto pr-1 text-xs sm:grid-cols-3">
            {catalog.map((r) => {
              const on = selected.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(r.id)}
                  title={r.label}
                  className={cn(
                    "flex min-h-10 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    on
                      ? "bg-[color-mix(in_oklch,var(--color-primary)_15%,transparent)] text-fg"
                      : "text-muted hover:bg-[color-mix(in_oklch,var(--color-fg)_6%,transparent)] hover:text-fg",
                  )}
                >
                  <Check className={cn("size-3 shrink-0", !on && "opacity-0")} aria-hidden />
                  <span className="min-w-0 truncate">{r.id}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              {tc("clear")}
            </Button>
            <Button size="sm" loading={save.pending} onClick={() => void save.run(selected)}>
              <Save className="size-3.5" aria-hidden />
              {tc("save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
