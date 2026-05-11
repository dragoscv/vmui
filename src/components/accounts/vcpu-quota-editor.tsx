"use client";

import { useState, useTransition } from "react";
import { Loader2, Save, Cpu } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateVcpuQuotaAction } from "@/server/actions/account-policy";

interface Props {
  accountId: string;
  initial: number | null;
}

export function VcpuQuotaEditor({ accountId, initial }: Props) {
  const [val, setVal] = useState<string>(initial == null ? "" : String(initial));
  const [pending, start] = useTransition();

  function save() {
    const raw = val.trim();
    const n = raw === "" ? null : Number.parseInt(raw, 10);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100_000)) {
      toast.error("Enter a positive integer, or leave empty to disable.");
      return;
    }
    start(async () => {
      const r = await updateVcpuQuotaAction({ accountId, vcpu: n });
      if (r.ok) toast.success(n == null ? "vCPU quota cleared" : `Cap: ${n} vCPU`);
      else toast.error("Save failed", { description: r.error });
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Cpu className="h-3.5 w-3.5" />
        Sum of vCPUs across running instances cannot exceed this.
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="0"
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          className="max-w-32 text-xs"
        />
        <span className="text-xs text-muted">vCPUs</span>
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}
