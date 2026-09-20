"use client";

import { toError, toResult } from "@/components/settings/adapt";
import { Button, Input } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import { backfillAccountDefaultTags, updateAccountDefaultTags } from "@/server/actions/accounts";
import { Plus, Save, Trash2, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

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
  const t = useTranslations("cloud.accountDetail");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<Row[]>(() => parseInitial(initial));

  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setRows((prev) => [...prev, { key: "", value: "" }]);

  const save = useAction(
    async () =>
      toResult(
        await updateAccountDefaultTags(
          accountId,
          rows.map((r) => ({ key: r.key.trim(), value: r.value })).filter((r) => r.key.length > 0),
        ),
      ),
    { success: t("defaultTags.saved") },
  );

  const backfill = useAction(
    async () => {
      const r = await backfillAccountDefaultTags(accountId);
      return r.ok ? ok(r.updated) : toError(r);
    },
    { success: (updated) => t("defaultTags.backfilled", { count: updated }) },
  );

  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-xs text-muted">{t("defaultTags.empty")}</p>}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label={t("defaultTags.keyLabel")}
              placeholder={t("defaultTags.keyPlaceholder")}
              value={row.key}
              onChange={(e) => update(i, { key: e.target.value })}
              className="min-w-0 max-w-44 font-mono text-xs"
              maxLength={64}
            />
            <span className="text-muted" aria-hidden>
              =
            </span>
            <Input
              aria-label={t("defaultTags.valueLabel")}
              placeholder={t("defaultTags.valuePlaceholder")}
              value={row.value}
              onChange={(e) => update(i, { value: e.target.value })}
              className="min-w-0 font-mono text-xs"
              maxLength={256}
            />
            <Button variant="ghost" size="icon" onClick={() => remove(i)} type="button" aria-label={t("defaultTags.removeRow")}>
              <Trash2 className="size-3.5 text-danger" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="size-3.5" aria-hidden />
          {t("defaultTags.add")}
        </Button>
        <Button type="button" size="sm" loading={save.pending} onClick={() => void save.run()}>
          <Save className="size-3.5" aria-hidden />
          {tc("save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={rows.length === 0}
          loading={backfill.pending}
          onClick={() => void backfill.run()}
          title={t("defaultTags.backfillHint")}
        >
          <Wand2 className="size-3.5" aria-hidden />
          {t("defaultTags.backfill")}
        </Button>
      </div>
    </div>
  );
}
