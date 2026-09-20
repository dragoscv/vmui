"use client";

import { toResult } from "@/components/settings/adapt";
import { Badge, Button, Field, Input } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { updateRequiredTagsAction } from "@/server/actions/account-policy";
import { Plus, Save, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

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
  const t = useTranslations("cloud.accountDetail");
  const tc = useTranslations("common");
  const [keys, setKeys] = useState<string[]>(parseInitial(initial));
  const [draft, setDraft] = useState("");

  const save = useAction(async (next: string[]) => toResult(await updateRequiredTagsAction({ accountId, keys: next })), {
    success: () => (keys.length === 0 ? t("requiredTags.cleared") : t("requiredTags.saved", { count: keys.length })),
  });

  function addKey() {
    const k = draft.trim();
    if (!k || keys.includes(k)) return;
    setKeys((p) => [...p, k]);
    setDraft("");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {keys.map((k) => (
          <Badge key={k} variant="muted" className="gap-1">
            <span className="min-w-0 truncate">{k}</span>
            <button
              type="button"
              onClick={() => setKeys((p) => p.filter((x) => x !== k))}
              aria-label={t("requiredTags.remove", { key: k })}
              className="rounded-full p-0.5 hover:bg-[color-mix(in_oklch,var(--color-fg)_12%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="size-3" aria-hidden />
            </button>
          </Badge>
        ))}
        {keys.length === 0 && <span className="text-xs text-muted">{t("requiredTags.empty")}</span>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("requiredTags.label")} hint={t("requiredTags.hint")} className="min-w-0 flex-1 basis-48">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("requiredTags.placeholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addKey();
              }
            }}
          />
        </Field>
        <Button size="sm" variant="ghost" className="h-9" onClick={addKey}>
          <Plus className="size-3.5" aria-hidden /> {tc("add")}
        </Button>
        <Button size="sm" className="h-9" loading={save.pending} onClick={() => void save.run(keys)}>
          <Save className="size-3.5" aria-hidden />
          {tc("save")}
        </Button>
      </div>
    </div>
  );
}
