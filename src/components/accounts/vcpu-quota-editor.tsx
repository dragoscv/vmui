"use client";

import { toResult } from "@/components/settings/adapt";
import { Button, Field, Input } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { updateVcpuQuotaAction } from "@/server/actions/account-policy";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  accountId: string;
  initial: number | null;
}

export function VcpuQuotaEditor({ accountId, initial }: Props) {
  const t = useTranslations("cloud.accountDetail");
  const tc = useTranslations("common");
  const [val, setVal] = useState<string>(initial == null ? "" : String(initial));

  const save = useAction(async (vcpu: number | null) => toResult(await updateVcpuQuotaAction({ accountId, vcpu })), {
    success: () => (val.trim() === "" ? t("vcpu.cleared") : t("vcpu.saved", { count: Number.parseInt(val, 10) })),
  });

  function submit() {
    const raw = val.trim();
    const n = raw === "" ? null : Number.parseInt(raw, 10);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100_000)) {
      toast.error(t("vcpu.invalid"));
      return;
    }
    void save.run(n);
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t("vcpu.label")} hint={t("vcpu.hint")} className="min-w-0 flex-1 basis-40">
        <Input value={val} onChange={(e) => setVal(e.target.value)} placeholder="0" type="number" inputMode="numeric" min="0" step="1" />
      </Field>
      <Button size="sm" className="h-9" loading={save.pending} onClick={submit}>
        <Save className="size-3.5" aria-hidden />
        {tc("save")}
      </Button>
    </div>
  );
}
