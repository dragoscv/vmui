"use client";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/settings-panel";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { err, ok } from "@/lib/action-result";
import {
    disableAutoStartAction,
    enableAutoStartAction,
    getAutoStartStatusAction,
} from "@/server/actions/local-kvm";
import { Power } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export function AutoStartToggle({ accountId }: { accountId: string }) {
  const t = useTranslations("vm.actions.autoStart");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const confirm = useConfirm();
  const { run, pending } = useAction(
    async (next: boolean) => {
      const r = next ? await enableAutoStartAction(accountId) : await disableAutoStartAction(accountId);
      return r.ok ? ok(next) : err(r.error ?? "common.error");
    },
    {
      success: (next) => t(next ? "enabledToast" : "disabledToast"),
      onSuccess: (next) => setEnabled(next),
    },
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await getAutoStartStatusAction(accountId);
      if (cancelled) return;
      if (r.ok) setEnabled(r.enabled);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  async function toggle() {
    if (enabled === null) return;
    if (!enabled) {
      const confirmed = await confirm({
        title: t("confirmTitle"),
        description: t.rich("confirmBody", {
          b: (c) => <b>{c}</b>,
          code: (c) => <code className="font-mono text-[11px]">{c}</code>,
        }),
        tone: "info",
        confirmText: t("enable"),
      });
      if (!confirmed) return;
    }
    void run(!enabled);
  }

  const loading = enabled === null || pending;

  return (
    <Field
      inline
      label={
        <span className="flex items-center gap-1.5 font-medium">
          <Power className="h-3.5 w-3.5" aria-hidden />
          {t("title")}
        </span>
      }
      hint={t.rich("description", { code: (c) => <code>{c}</code> })}
    >
      <Switch checked={!!enabled} disabled={loading} onCheckedChange={() => void toggle()} />
    </Field>
  );
}
