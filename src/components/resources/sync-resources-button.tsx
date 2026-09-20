"use client";

import { Button } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { err, ok } from "@/lib/action-result";
import { syncAllResources } from "@/server/actions/resources";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

export function SyncResourcesButton() {
  const t = useTranslations("cloud.resources");
  const sync = useCallback(async () => {
    const r = await syncAllResources();
    return r.ok ? ok(r.total) : err("cloud.resources.syncFailed");
  }, []);
  const { run, pending } = useAction(sync, { success: (total) => t("synced", { count: total }) });
  return (
    <Button onClick={() => void run()} loading={pending}>
      <RefreshCw className="size-4" aria-hidden />
      {t("sync")}
    </Button>
  );
}
