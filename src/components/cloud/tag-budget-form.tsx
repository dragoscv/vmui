"use client";

import { Button, Field, Input } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import { upsertTagBudgetAction } from "@/server/actions/automation";
import { useTranslations } from "next-intl";
import * as React from "react";

export function TagBudgetForm() {
  const t = useTranslations("cloud.budgets");
  const tc = useTranslations("common");
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useAction(
    async (input: { tagKey: string; tagValue: string; monthlyUsd: number }) => {
      await upsertTagBudgetAction(input);
      return ok();
    },
    { success: t("form.saved"), onSuccess: () => formRef.current?.reset() },
  );

  return (
    <form
      ref={formRef}
      className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        void save.run({
          tagKey: String(fd.get("tagKey") ?? "").trim(),
          tagValue: String(fd.get("tagValue") ?? "").trim(),
          monthlyUsd: Number(fd.get("monthlyUsd") ?? 0),
        });
      }}
    >
      <Field label={t("form.tagKey")}>
        <Input name="tagKey" required maxLength={64} placeholder={t("form.tagKeyPlaceholder")} className="font-mono" />
      </Field>
      <Field label={t("form.tagValue")}>
        <Input name="tagValue" required maxLength={128} placeholder={t("form.tagValuePlaceholder")} className="font-mono" />
      </Field>
      <Field label={t("form.monthlyUsd")}>
        <Input name="monthlyUsd" type="number" min={1} step={1} required inputMode="numeric" placeholder={t("form.monthlyUsdPlaceholder")} />
      </Field>
      <Button type="submit" loading={save.pending} className="h-10 sm:h-9">
        {tc("save")}
      </Button>
    </form>
  );
}
