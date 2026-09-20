"use client";

import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { err, ok } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { setTerminationLockAction } from "@/server/actions/instance-lock";
import { Lock, Unlock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function TerminationLockButton({
  accountId,
  region,
  providerInstanceId,
  initial,
}: {
  accountId: string;
  region: string;
  providerInstanceId: string;
  initial: boolean;
}) {
  const t = useTranslations("vm.actions.lock");
  const [locked, setLocked] = useState(initial);
  const { run, pending } = useAction(
    async (next: boolean) => {
      const r = await setTerminationLockAction({ accountId, region, providerInstanceId, locked: next });
      return r.ok ? ok(next) : err(r.error ?? "common.error");
    },
    { success: (next) => t(next ? "lockedToast" : "unlockedToast") },
  );
  const Icon = locked ? Lock : Unlock;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      loading={pending}
      aria-pressed={locked}
      title={locked ? t("unlockHint") : t("lockHint")}
      onClick={async () => {
        const next = !locked;
        setLocked(next);
        const r = await run(next);
        if (!r.ok) setLocked(!next);
      }}
    >
      <Icon className={cn("h-3.5 w-3.5", locked ? "text-warning" : "text-muted")} aria-hidden />
      {locked ? t("locked") : t("unlocked")}
    </Button>
  );
}
