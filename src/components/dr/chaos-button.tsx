"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck, AlertTriangle, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { runDrDrillAction } from "@/server/actions/dr";
import type { DrillResult, DrillCheck } from "@/lib/dr-drill";

export function ChaosButton() {
  const [result, setResult] = useState<DrillResult | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    setResult(null);
    start(async () => {
      const r = await runDrDrillAction();
      if (r.ok) {
        setResult(r.result);
        toast[r.result.failed > 0 ? "error" : r.result.warned > 0 ? "warning" : "success"](r.result.summary);
      } else toast.error(r.error);
    });
  };

  return (
    <div className="grid gap-4">
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className="inline-flex w-fit items-center gap-2 rounded-md bg-gradient-to-r from-amber-500 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-lg disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        Run DR drill
      </button>
      {result ? (
        <>
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            <Stat label="Passed" value={result.passed.toString()} color="emerald" />
            <Stat label="Warnings" value={result.warned.toString()} color="amber" />
            <Stat label="Failures" value={result.failed.toString()} color="rose" />
          </div>
          <ul className="space-y-1 text-xs">
            {result.checks.map((c, i) => (
              <li key={i} className="flex gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
                <Badge c={c} />
                <span className="font-semibold">{c.name}</span>
                <span className="truncate text-muted">{c.detail}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Badge({ c }: { c: DrillCheck }) {
  if (c.status === "pass") return <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-300" />;
  if (c.status === "warn") return <AlertTriangle className="h-3 w-3 shrink-0 text-amber-300" />;
  return <XCircle className="h-3 w-3 shrink-0 text-rose-300" />;
}

function Stat({ label, value, color }: { label: string; value: string; color: "emerald" | "amber" | "rose" }) {
  const cls = color === "emerald" ? "text-emerald-300" : color === "amber" ? "text-amber-300" : "text-rose-300";
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
      <div className={`text-2xl font-semibold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
