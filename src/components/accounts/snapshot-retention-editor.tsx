"use client";

import { toError, toResult } from "@/components/settings/adapt";
import { Button, Field, Input } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import { applySnapshotRetentionAction, updateSnapshotRetentionAction } from "@/server/actions/snapshot-retention";
import { Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  accountId: string;
  initial: number | null;
}

export function SnapshotRetentionEditor({ accountId, initial }: Props) {
  const t = useTranslations("cloud.accountDetail");
  const tc = useTranslations("common");
  const [keepLast, setKeepLast] = useState<string>(initial == null ? "" : String(initial));

  const save = useAction(async (n: number) => toResult(await updateSnapshotRetentionAction({ accountId, keepLast: n })), {
    success: () => (keepLast.trim() === "" || keepLast.trim() === "0" ? t("retention.disabled") : t("retention.saved", { count: Number.parseInt(keepLast, 10) })),
  });

  const runNow = useAction(
    async () => {
      const r = await applySnapshotRetentionAction(accountId);
      return r.ok ? ok(r.deleted) : toError(r);
    },
    { success: (deleted) => t("retention.deleted", { count: deleted }) },
  );

  function submit() {
    const n = keepLast.trim() === "" ? 0 : Number.parseInt(keepLast, 10);
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      toast.error(t("retention.invalid"));
      return;
    }
    void save.run(n);
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t("retention.label")} hint={t("retention.hint")} className="min-w-0 flex-1 basis-40">
        <Input value={keepLast} onChange={(e) => setKeepLast(e.target.value)} placeholder="0" type="number" inputMode="numeric" min="0" max="1000" />
      </Field>
      <Button size="sm" className="h-9" loading={save.pending} onClick={submit}>
        <Save className="size-3.5" aria-hidden />
        {tc("save")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-9"
        loading={runNow.pending}
        disabled={keepLast === "" || keepLast === "0"}
        onClick={() => void runNow.run()}
      >
        <Trash2 className="size-3.5" aria-hidden />
        {t("retention.runNow")}
      </Button>
    </div>
  );
}
