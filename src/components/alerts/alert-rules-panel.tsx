"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Power, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  createAlertRuleAction,
  deleteAlertRuleAction,
  toggleAlertRuleAction,
  evaluateRulesNowAction,
} from "@/server/actions/alerts";
import type { AlertRuleRow, AlertChannelRow } from "@/lib/db/schema";

interface Props {
  rules: AlertRuleRow[];
  channels: AlertChannelRow[];
}

const METRICS = ["cpu", "mem", "disk", "net_in", "net_out", "load1", "uptime"] as const;
const OPS = [">", "<", ">=", "<=", "==", "!="] as const;

export function AlertRulesPanel({ rules, channels }: Props) {
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [severity, setSeverity] = useState<"info" | "warning" | "critical">("warning");
  const [metric, setMetric] = useState<(typeof METRICS)[number]>("cpu");
  const [op, setOp] = useState<(typeof OPS)[number]>(">");
  const [threshold, setThreshold] = useState("80");
  const [windowSec, setWindowSec] = useState("120");
  const [cooldownSec, setCooldownSec] = useState("600");
  const [pickedChannels, setPickedChannels] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState("{{instance}}: {{metric}} = {{value}} (> {{threshold}})");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pickedChannels.size === 0) {
      toast.error("Select at least one channel");
      return;
    }
    startTransition(async () => {
      const out = await createAlertRuleAction({
        name,
        severity,
        enabled: true,
        expression: {
          metric,
          op,
          threshold: Number(threshold),
          windowSec: Number(windowSec),
          cooldownSec: Number(cooldownSec),
        },
        scope: null,
        channelIds: Array.from(pickedChannels),
        messageTemplate: template,
      });
      if (out.ok) {
        toast.success("Rule created");
        setAdding(false);
        setName("");
        setPickedChannels(new Set());
      } else {
        toast.error(out.error ?? "Create failed");
      }
    });
  };

  const toggle = (id: string, enabled: boolean) => {
    startTransition(async () => {
      await toggleAlertRuleAction({ id, enabled });
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this rule?")) return;
    startTransition(async () => {
      await deleteAlertRuleAction({ id });
      toast.success("Deleted");
    });
  };

  const evalNow = () => {
    startTransition(async () => {
      await evaluateRulesNowAction();
      toast.success("Evaluation triggered");
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Rules</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={evalNow} disabled={pending}>
            <Play className="mr-1 h-3.5 w-3.5" /> Evaluate now
          </Button>
          <Button size="sm" onClick={() => setAdding((s) => !s)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> {adding ? "Cancel" : "Add"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {adding && (
          <form onSubmit={submit} className="mb-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs">
            <div className="grid gap-2 sm:grid-cols-2">
              <label>
                <span className="mb-0.5 block font-medium">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1" />
              </label>
              <label>
                <span className="mb-0.5 block font-medium">Severity</span>
                <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
                  <option value="info">info</option>
                  <option value="warning">warning</option>
                  <option value="critical">critical</option>
                </select>
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label>
                <span className="mb-0.5 block font-medium">Metric</span>
                <select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
                  {METRICS.map((m) => (<option key={m} value={m}>{m}</option>))}
                </select>
              </label>
              <label>
                <span className="mb-0.5 block font-medium">Op</span>
                <select value={op} onChange={(e) => setOp(e.target.value as typeof op)} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
                  {OPS.map((o) => (<option key={o} value={o}>{o}</option>))}
                </select>
              </label>
              <label>
                <span className="mb-0.5 block font-medium">Threshold</span>
                <input type="number" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} required className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1" />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label>
                <span className="mb-0.5 block font-medium">Sustain for (sec)</span>
                <input type="number" value={windowSec} onChange={(e) => setWindowSec(e.target.value)} required className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1" />
              </label>
              <label>
                <span className="mb-0.5 block font-medium">Cooldown (sec)</span>
                <input type="number" value={cooldownSec} onChange={(e) => setCooldownSec(e.target.value)} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1" />
              </label>
            </div>
            <label className="block">
              <span className="mb-0.5 block font-medium">Message template</span>
              <input value={template} onChange={(e) => setTemplate(e.target.value)} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono" />
            </label>
            <div>
              <span className="mb-1 block font-medium">Channels</span>
              {channels.length === 0 ? (
                <div className="text-muted">Create a channel first.</div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {channels.map((c) => {
                    const on = pickedChannels.has(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setPickedChannels((s) => {
                            const next = new Set(s);
                            if (next.has(c.id)) next.delete(c.id);
                            else next.add(c.id);
                            return next;
                          })
                        }
                        className={`rounded-full border px-2 py-0.5 ${on ? "border-[var(--color-primary)] bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] text-[var(--color-primary)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              Save rule
            </Button>
          </form>
        )}

        {rules.length === 0 ? (
          <div className="grid place-items-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] py-6 text-xs text-muted">
            No rules yet. Try: CPU &gt; 80% sustained 2min, cooldown 10min.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {rules.map((r) => {
              let expr: { metric: string; op: string; threshold: number; windowSec: number } | null = null;
              try {
                expr = JSON.parse(r.expressionJson);
              } catch {
                /* */
              }
              return (
                <li key={r.id} className="flex items-center gap-3 py-2 text-xs">
                  <button
                    type="button"
                    onClick={() => toggle(r.id, !r.enabled)}
                    title={r.enabled ? "Disable" : "Enable"}
                    className={`grid h-5 w-5 place-items-center rounded ${r.enabled ? "text-[var(--color-primary)]" : "text-muted"}`}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <span className="font-semibold">{r.name}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${r.severity === "critical" ? "bg-red-500/15 text-red-600 dark:text-red-300" : r.severity === "warning" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300"}`}>
                    {r.severity}
                  </span>
                  {expr && (
                    <span className="font-mono text-muted">
                      {expr.metric} {expr.op} {expr.threshold} · {expr.windowSec}s
                    </span>
                  )}
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" onClick={() => remove(r.id)} disabled={pending} className="text-red-600 hover:bg-red-500/10 dark:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
