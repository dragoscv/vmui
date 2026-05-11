"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Wrench } from "lucide-react";
import { toast } from "sonner";
import { revokeOpenWorldRuleAction } from "@/server/actions/compliance-fix";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function ComplianceFixButton({
  accountId,
  groupId,
  port,
  label,
}: {
  accountId: string;
  groupId: string;
  port: number;
  label: string;
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
          title: `Revoke open-world ${label} rule?`,
          description: `Removes 0.0.0.0/0 ingress on port ${port} from ${groupId}. Reversible by re-adding the rule.`,
          confirmText: "Revoke",
        });
        if (!ok) return;
        startTransition(async () => {
          const r = await revokeOpenWorldRuleAction({ accountId, groupId, port });
          if (!r.ok) toast.error(r.error);
          else toast.success("Rule revoked.");
        });
      }}
    >
      <Wrench className="h-3.5 w-3.5" />
      Revoke
    </Button>
  );
}
