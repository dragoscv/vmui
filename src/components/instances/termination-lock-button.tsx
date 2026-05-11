"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Lock, Unlock } from "lucide-react";
import { setTerminationLockAction } from "@/server/actions/instance-lock";

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
  const [locked, setLocked] = useState(initial);
  const [pending, start] = useTransition();
  const Icon = locked ? Lock : Unlock;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const next = !locked;
        setLocked(next);
        start(async () => {
          const r = await setTerminationLockAction({
            accountId,
            region,
            providerInstanceId,
            locked: next,
          });
          if (!r.ok) {
            toast.error(r.error ?? "Failed to update");
            setLocked(!next);
          } else {
            toast.success(next ? "Termination locked" : "Termination unlocked");
          }
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
      title={locked ? "Click to unlock terminate" : "Click to prevent accidental terminate"}
    >
      <Icon className={`h-3.5 w-3.5 ${locked ? "text-[var(--color-warning)]" : "text-muted"}`} />
      {locked ? "Locked" : "Unlocked"}
    </button>
  );
}
