"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { deleteOrphanResourceAction } from "@/server/actions/orphan-cleanup";

export function OrphanCleanupButton({
  accountId,
  resourceId,
  externalId,
  kind,
}: {
  accountId: string;
  resourceId: string;
  externalId: string;
  kind: string;
}) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={async () => {
        const ok = await confirm({
          title: `Delete orphan ${kind}?`,
          description: `Permanently deletes ${externalId}. This cannot be undone — the resource will be gone from the cloud provider.`,
          confirmText: "Delete",
          tone: "danger",
          requireText: externalId,
        });
        if (!ok) return;
        startTransition(async () => {
          const r = await deleteOrphanResourceAction({ accountId, resourceId });
          if (!r.ok) toast.error(r.error);
          else toast.success(`Deleted ${kind}.`);
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
      Delete
    </Button>
  );
}
