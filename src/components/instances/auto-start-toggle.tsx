"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Power } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  enableAutoStartAction,
  disableAutoStartAction,
  getAutoStartStatusAction,
} from "@/server/actions/local-kvm";

export function AutoStartToggle({ accountId }: { accountId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

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
      const ok = await confirm({
        title: "Enable auto-start on Windows sign-in?",
        description: (
          <>
            This creates a Windows <b>scheduled task</b> that boots the macOS VM
            via <code className="font-mono text-[11px]">wsl.exe</code> every
            time you sign in to your account.
          </>
        ),
        tone: "info",
        confirmText: "Enable",
      });
      if (!ok) return;
    }
    startTransition(async () => {
      const r = enabled
        ? await disableAutoStartAction(accountId)
        : await enableAutoStartAction(accountId);
      if (r.ok) {
        setEnabled(!enabled);
        toast.success(
          !enabled ? "Auto-start enabled (on user logon)" : "Auto-start disabled",
        );
      } else {
        toast.error(r.error ?? "Failed");
      }
    });
  }

  const loading = enabled === null || pending;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] p-3">
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Power className="h-3.5 w-3.5" />
          Auto-start on Windows sign-in
        </div>
        <div className="text-xs text-muted">
          Creates a Windows scheduled task that boots this VM via{" "}
          <code>wsl.exe</code> when you log in.
        </div>
      </div>
      <Button
        size="sm"
        variant={enabled ? "secondary" : "primary"}
        disabled={loading}
        onClick={toggle}
        aria-pressed={!!enabled}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : enabled ? (
          "Disable"
        ) : (
          "Enable"
        )}
      </Button>
    </div>
  );
}
