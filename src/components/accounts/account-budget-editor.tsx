"use client";

import { toResult } from "@/components/settings/adapt";
import { Button, Field, Input } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { updateMonthlyBudgetAction } from "@/server/actions/account-budget";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  accountId: string;
  initial: number | null;
}

export function AccountBudgetEditor({ accountId, initial }: Props) {
  const t = useTranslations("cloud.accountDetail");
  const tc = useTranslations("common");
  const [val, setVal] = useState<string>(initial == null ? "" : String(initial));

  const save = useAction(
    async (monthlyUsd: number | null) => toResult(await updateMonthlyBudgetAction({ accountId, monthlyUsd })),
    { success: () => (val.trim() === "" ? t("budget.cleared") : t("budget.saved", { amount: val.trim() })) },
  );

  function submit() {
    const raw = val.trim();
    const n = raw === "" ? null : Number.parseFloat(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      toast.error(t("budget.invalid"));
      return;
    }
    void save.run(n);
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t("budget.label")} hint={t("budget.hint")} className="min-w-0 flex-1 basis-40">
        <Input value={val} onChange={(e) => setVal(e.target.value)} placeholder="0" type="number" inputMode="decimal" min="0" step="any" />
      </Field>
      <Button size="sm" className="h-9" loading={save.pending} onClick={submit}>
        <Save className="size-3.5" aria-hidden />
        {tc("save")}
      </Button>
    </div>
  );
}
