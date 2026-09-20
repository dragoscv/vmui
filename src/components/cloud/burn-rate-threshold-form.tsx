"use client";

import { Button, Field, Input } from "@/components/ui";
import { useTranslations } from "next-intl";
import { useFormStatus } from "react-dom";

function SubmitButton() {
  const tc = useTranslations("common");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="h-10 sm:h-9">
      {tc("save")}
    </Button>
  );
}

export function BurnRateThresholdForm({ threshold, action }: { threshold: number; action: (formData: FormData) => Promise<void> }) {
  const t = useTranslations("cloud.burnRate");
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end">
      <Field label={t("threshold.label")} hint={t("threshold.hint")}>
        <Input type="number" step="0.01" min={0} inputMode="decimal" name="threshold" defaultValue={threshold} className="tabular-nums" />
      </Field>
      <SubmitButton />
    </form>
  );
}
