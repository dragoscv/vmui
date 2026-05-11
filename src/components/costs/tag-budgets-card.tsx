"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Plus, Save, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteTagBudgetAction,
  evaluateTagBudgetsAction,
  listTagBudgetsAction,
  upsertTagBudgetAction,
  type TagBudgetEvalResult,
} from "@/server/actions/tag-budgets";

interface BudgetRow {
  id: string;
  tagKey: string;
  tagValue: string | null;
  monthlyUsd: number;
  lastObservedUsd: number | null;
  exceeded: number;
}

interface DraftRow {
  id?: string;
  tagKey: string;
  tagValue: string;
  monthlyUsd: string;
}

function formatUsd(v: number): string {
  return `$${v.toFixed(v < 100 ? 2 : 0)}`;
}

export function TagBudgetsCard() {
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [evalResults, setEvalResults] = useState<Map<string, TagBudgetEvalResult>>(new Map());
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [pending, start] = useTransition();
  const [evaluating, startEval] = useTransition();

  async function refresh() {
    const list = await listTagBudgetsAction();
    setRows(list as BudgetRow[]);
  }
  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    startEval(async () => {
      const res = await evaluateTagBudgetsAction();
      setEvalResults(new Map(res.map((r) => [r.id, r])));
    });
  }, [rows.length]);

  function save() {
    if (!draft) return;
    const amount = Number.parseFloat(draft.monthlyUsd);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive monthly amount.");
      return;
    }
    start(async () => {
      const r = await upsertTagBudgetAction({
        id: draft.id,
        tagKey: draft.tagKey.trim(),
        tagValue: draft.tagValue.trim() || null,
        monthlyUsd: amount,
      });
      if (r.ok) {
        toast.success("Budget saved");
        setDraft(null);
        await refresh();
      } else {
        toast.error("Save failed", { description: r.error });
      }
    });
  }

  async function remove(id: string) {
    await deleteTagBudgetAction(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Target className="h-4 w-4" /> Per-tag budgets
            </CardTitle>
            <CardDescription>
              Set monthly USD caps per tag. Evaluated against current fleet hourly burn × 730.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setDraft({ tagKey: "", tagValue: "", monthlyUsd: "" })
            }
            disabled={pending}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && !draft && (
          <p className="text-xs text-muted">No budgets yet. Click Add to set one.</p>
        )}
        {rows.map((b) => {
          const ev = evalResults.get(b.id);
          const observed = ev?.observedUsd ?? b.lastObservedUsd ?? 0;
          const exceeded = ev?.exceeded ?? b.exceeded === 1;
          const pct = b.monthlyUsd > 0 ? Math.min(150, (observed / b.monthlyUsd) * 100) : 0;
          return (
            <div
              key={b.id}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-[12px]">
                    {b.tagKey}
                    {b.tagValue ? `=${b.tagValue}` : <span className="text-muted"> (any value)</span>}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted">
                    {formatUsd(observed)}/mo observed · cap {formatUsd(b.monthlyUsd)}
                    {ev?.daysToExceed != null && ev.daysToExceed > 0 && !exceeded && (
                      <span className="ml-2 text-[var(--color-warning)]">
                        · ≈ {ev.daysToExceed}d to cap
                      </span>
                    )}
                  </div>
                </div>
                {exceeded && (
                  <span className="flex items-center gap-1 text-[var(--color-danger)]">
                    <AlertTriangle className="h-3.5 w-3.5" /> over budget
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted hover:text-[var(--color-danger)]"
                  onClick={() => remove(b.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-[var(--color-border)]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, pct)}%`,
                    background: exceeded
                      ? "var(--color-danger)"
                      : pct > 80
                        ? "var(--color-warning)"
                        : "var(--color-success)",
                  }}
                />
              </div>
            </div>
          );
        })}

        {draft && (
          <div className="space-y-2 rounded-md border border-dashed border-[var(--color-border)] p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                placeholder="tag key (e.g. team)"
                value={draft.tagKey}
                onChange={(e) => setDraft({ ...draft, tagKey: e.target.value })}
                className="font-mono text-xs"
                maxLength={64}
              />
              <Input
                placeholder="value (blank = any)"
                value={draft.tagValue}
                onChange={(e) => setDraft({ ...draft, tagValue: e.target.value })}
                className="font-mono text-xs"
                maxLength={256}
              />
              <Input
                placeholder="500"
                value={draft.monthlyUsd}
                onChange={(e) => setDraft({ ...draft, monthlyUsd: e.target.value })}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className="text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={pending || !draft.tagKey.trim()}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={pending}>
                Cancel
              </Button>
              {evaluating && (
                <span className="ml-auto flex items-center gap-1 text-[11px] text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" /> evaluating…
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
