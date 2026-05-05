"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteAccount } from "@/server/actions/accounts";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function DeleteAccountButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={pending}
      onClick={async () => {
        const ok = await confirm({
          title: `Disconnect ${name}?`,
          description: (
            <>
              Stored credentials for this account will be wiped and instances
              will disappear from the dashboard. This <b>cannot</b> be undone.
            </>
          ),
          tone: "danger",
          confirmText: "Disconnect",
          requireText: name,
        });
        if (!ok) return;
        start(async () => {
          const r = await deleteAccount(id);
          if (r.ok) {
            toast.success(`${name} disconnected`);
            router.refresh();
          } else toast.error(r.error ?? "Failed");
        });
      }}
    >
      <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
    </Button>
  );
}
