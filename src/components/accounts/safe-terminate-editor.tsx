"use client";

import { toError } from "@/components/settings/adapt";
import { Field, Switch } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import { updateSafeTerminateAction } from "@/server/actions/account-policy";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function SafeTerminateEditor({ accountId, initial }: { accountId: string; initial: boolean }) {
  const t = useTranslations("cloud.accountDetail");
  const [enabled, setEnabled] = useState(initial);

  const update = useAction(
    async (next: boolean) => {
      const r = await updateSafeTerminateAction({ accountId, enabled: next });
      return r.ok ? ok(next) : toError(r);
    },
    { success: (next) => (next ? t("safeTerminate.enabled") : t("safeTerminate.disabled")) },
  );

  const toggle = async (next: boolean) => {
    setEnabled(next);
    const r = await update.run(next);
    if (!r.ok) setEnabled(!next);
  };

  return (
    <Field inline label={t("safeTerminate.label")} hint={t("safeTerminate.hint")}>
      <Switch checked={enabled} onCheckedChange={(v) => void toggle(v)} disabled={update.pending} aria-label={t("safeTerminate.label")} />
    </Field>
  );
}
