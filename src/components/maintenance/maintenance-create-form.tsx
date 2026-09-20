"use client";

import { toResult } from "@/components/settings/adapt";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { createMaintenanceWindowAction } from "@/server/actions/maintenance";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

const GLOBAL = "__global__";

interface Draft {
  name: string;
  startsAt: string;
  endsAt: string;
  mode: "warn" | "block";
  accountId: string;
  reason: string;
}

const EMPTY: Draft = { name: "", startsAt: "", endsAt: "", mode: "warn", accountId: GLOBAL, reason: "" };

export function MaintenanceCreateForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const t = useTranslations("ops.maintenance");
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const create = useAction(
    async (d: Draft) =>
      toResult(
        await createMaintenanceWindowAction({
          name: d.name,
          startsAt: d.startsAt,
          endsAt: d.endsAt,
          mode: d.mode,
          accountId: d.accountId === GLOBAL ? null : d.accountId,
          reason: d.reason || null,
        }),
      ),
    { success: t("created"), onSuccess: () => setDraft(EMPTY) },
  );

  const canSave = draft.name.trim().length > 0 && draft.startsAt !== "" && draft.endsAt !== "";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void create.run(draft);
      }}
    >
      <Field label={t("fields.name")} hint={t("fields.nameHint")}>
        <Input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder={t("fields.namePlaceholder")}
          maxLength={120}
          required
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field label={t("fields.startsAt")}>
          <Input
            type="datetime-local"
            value={draft.startsAt}
            onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
            required
          />
        </Field>
        <Field label={t("fields.endsAt")}>
          <Input
            type="datetime-local"
            value={draft.endsAt}
            onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
            required
          />
        </Field>
        <Field label={t("fields.mode")} hint={t("fields.modeHint")}>
          <Select value={draft.mode} onValueChange={(v) => setDraft({ ...draft, mode: v as Draft["mode"] })}>
            <SelectTrigger aria-label={t("fields.mode")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="warn">{t("modes.warn")}</SelectItem>
              <SelectItem value="block">{t("modes.block")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("fields.scope")} hint={t("fields.scopeHint")} className="sm:col-span-2">
          <Select value={draft.accountId} onValueChange={(v) => setDraft({ ...draft, accountId: v })}>
            <SelectTrigger aria-label={t("fields.scope")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GLOBAL}>{t("scopeGlobal")}</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label={t("fields.reason")} hint={t("fields.reasonHint")}>
        <Textarea
          value={draft.reason}
          onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
          placeholder={t("fields.reasonPlaceholder")}
          rows={2}
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" loading={create.pending} disabled={!canSave}>
          <Plus className="size-4" aria-hidden /> {t("create")}
        </Button>
      </div>
    </form>
  );
}
