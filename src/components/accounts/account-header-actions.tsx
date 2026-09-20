"use client";

import { Button } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import { syncAccountInstances } from "@/server/actions/instances";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { DeleteAccountButton } from "./delete-account-button";

export function AccountHeaderActions({ accountId, name }: { accountId: string; name: string }) {
  const t = useTranslations("cloud.accountDetail");
  const sync = useAction(
    async (id: string) => {
      const r = await syncAccountInstances(id);
      return ok(r.count);
    },
    { success: (count) => t("sync.done", { count }) },
  );

  return (
    <>
      <Button variant="secondary" size="sm" loading={sync.pending} onClick={() => void sync.run(accountId)}>
        <RefreshCw className="size-4" aria-hidden /> {t("sync.label")}
      </Button>
      <DeleteAccountButton id={accountId} name={name} />
    </>
  );
}
