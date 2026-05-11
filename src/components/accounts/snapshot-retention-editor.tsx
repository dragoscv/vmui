"use client";

import { useState, useTransition } from "react";
import { Loader2, Save, Trash2, Camera } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  applySnapshotRetentionAction,
  updateSnapshotRetentionAction,
} from "@/server/actions/snapshot-retention";

interface Props {
  accountId: string;
  initial: number | null;
}

export function SnapshotRetentionEditor({ accountId, initial }: Props) {
  const [keepLast, setKeepLast] = useState<string>(initial == null ? "" : String(initial));
  const [savePending, startSave] = useTransition();
  const [runPending, startRun] = useTransition();

  function save() {
    const n = keepLast.trim() === "" ? 0 : Number.parseInt(keepLast, 10);
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      toast.error("Enter a non-negative integer up to 1000.");
      return;
    }
    startSave(async () => {
      const r = await updateSnapshotRetentionAction({ accountId, keepLast: n });
      if (r.ok) toast.success(n === 0 ? "Retention disabled" : `Retention: keep last ${n}`);
      else toast.error("Save failed", { description: r.error });
    });
  }

  function runNow() {
    startRun(async () => {
      const r = await applySnapshotRetentionAction(accountId);
      if (r.ok) toast.success(`Deleted ${r.deleted} old snapshot${r.deleted === 1 ? "" : "s"}`);
      else toast.error("Retention run incomplete", {
        description: r.error ?? `${r.deleted} ok / ${r.failed} failed`,
      });
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Camera className="h-3.5 w-3.5" />
        Keep at most N snapshots per instance. Leave 0 / empty to disable.
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={keepLast}
          onChange={(e) => setKeepLast(e.target.value)}
          placeholder="0"
          type="number"
          inputMode="numeric"
          min="0"
          max="1000"
          className="max-w-32 text-xs"
        />
        <Button size="sm" onClick={save} disabled={savePending}>
          {savePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={runNow}
          disabled={runPending || keepLast === "" || keepLast === "0"}
          title="Apply retention now"
        >
          {runPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Run now
        </Button>
      </div>
    </div>
  );
}
