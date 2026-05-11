"use client";

import { useState, useTransition } from "react";
import { Loader2, Save, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateMonthlyBudgetAction } from "@/server/actions/account-budget";

interface Props {
  accountId: string;
  initial: number | null;
}

export function AccountBudgetEditor({ accountId, initial }: Props) {
  const [val, setVal] = useState<string>(initial == null ? "" : String(initial));
  const [pending, start] = useTransition();

  function save() {
    const raw = val.trim();
    const n = raw === "" ? null : Number.parseFloat(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      toast.error("Enter a positive amount in USD, or leave empty to disable.");
      return;
    }
    start(async () => {
      const r = await updateMonthlyBudgetAction({ accountId, monthlyUsd: n });
      if (r.ok) toast.success(n == null ? "Budget cap cleared" : `Cap: $${n}/mo`);
      else toast.error("Save failed", { description: r.error });
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <DollarSign className="h-3.5 w-3.5" />
        Hard cap. Refuses new instances if projected monthly burn exceeds this.
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="0"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          className="max-w-40 text-xs"
        />
        <span className="text-xs text-muted">USD / month</span>
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}
