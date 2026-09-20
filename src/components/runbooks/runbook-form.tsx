"use client";

import { Button, Field, Input, PageSection, Textarea } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import { upsertRunbookAction } from "@/server/actions/automation";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

const EMPTY = { title: "", providerInstanceId: "", body: "" };

export function RunbookForm() {
  const t = useTranslations("ops.runbooks.form");
  const [draft, setDraft] = useState(EMPTY);

  const save = useAction(
    async (): Promise<ActionResult> => {
      await upsertRunbookAction({
        title: draft.title,
        body: draft.body,
        accountId: null,
        providerInstanceId: draft.providerInstanceId.trim() || null,
      });
      return ok();
    },
    { success: t("saved"), onSuccess: () => setDraft(EMPTY) },
  );

  const canSave = draft.title.trim().length > 0;

  return (
    <PageSection title={t("title")} description={t("description")}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save.run();
        }}
      >
        <Field label={t("name")}>
          <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={t("namePlaceholder")} required />
        </Field>
        <Field label={t("instance")} hint={t("instanceHint")}>
          <Input value={draft.providerInstanceId} onChange={(e) => setDraft({ ...draft, providerInstanceId: e.target.value })} placeholder={t("instancePlaceholder")} className="font-mono" />
        </Field>
        <Field label={t("body")} className="sm:col-span-2">
          <Textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            rows={8}
            placeholder={t("bodyPlaceholder")}
            className="font-mono text-xs"
          />
        </Field>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" loading={save.pending} disabled={!canSave}>
            <Save className="size-4" aria-hidden /> {t("submit")}
          </Button>
        </div>
      </form>
    </PageSection>
  );
}
