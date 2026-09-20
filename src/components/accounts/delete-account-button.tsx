"use client";

import { toResult } from "@/components/settings/adapt";
import { Button } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { deleteAccount } from "@/server/actions/accounts";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

export function DeleteAccountButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("cloud.accountDetail");
  const confirm = useConfirm();
  const remove = useAction(async () => toResult(await deleteAccount(id)), { success: t("disconnect.done", { name }) });

  return (
    <Button
      variant="ghost"
      size="icon"
      loading={remove.pending}
      aria-label={t("disconnect.label", { name })}
      onClick={async () => {
        const yes = await confirm({
          title: t("disconnect.title", { name }),
          description: t("disconnect.description"),
          tone: "danger",
          confirmText: t("disconnect.confirm"),
          requireText: name,
        });
        if (yes) await remove.run();
      }}
    >
      <Trash2 className="size-4 text-danger" aria-hidden />
    </Button>
  );
}
