"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateSafeTerminateAction } from "@/server/actions/account-policy";

export function SafeTerminateEditor({
  accountId,
  initial,
}: {
  accountId: string;
  initial: boolean;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, start] = useTransition();

  const toggle = (next: boolean) => {
    setEnabled(next);
    start(async () => {
      const r = await updateSafeTerminateAction({ accountId, enabled: next });
      if (!r.ok) {
        toast.error(r.error ?? "Failed to update");
        setEnabled(!next);
      } else {
        toast.success(next ? "Safe terminate enabled" : "Safe terminate disabled");
      }
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-[var(--color-primary)]" /> Safe terminate
        </CardTitle>
      </CardHeader>
      <CardContent>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggle(e.target.checked)}
            disabled={pending}
            className="mt-0.5 h-4 w-4"
          />
          <div>
            <div className="font-medium">Auto-snapshot before terminate</div>
            <p className="mt-0.5 text-xs text-muted">
              When enabled, the terminate action creates a fresh snapshot first if no recent (≤ 7 day) snapshot exists.
              Skips silently if the provider doesn't support snapshots.
            </p>
          </div>
        </label>
      </CardContent>
    </Card>
  );
}
