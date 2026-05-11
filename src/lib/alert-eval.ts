import type { ProbeMetrics } from "@/lib/probe";

export type MetricName = "cpu" | "mem" | "disk" | "net_in" | "net_out" | "load1" | "uptime";
export type Op = ">" | "<" | ">=" | "<=" | "==" | "!=";

export interface RuleExpression {
  metric: MetricName;
  op: Op;
  threshold: number;
  windowSec: number;
  cooldownSec?: number;
}

export function extractValue(m: ProbeMetrics, metric: MetricName): number {
  switch (metric) {
    case "cpu":
      return m.cpu;
    case "mem":
      return m.mem;
    case "disk":
      return m.disk;
    case "net_in":
      return m.netIn;
    case "net_out":
      return m.netOut;
    case "load1":
      return m.load1;
    case "uptime":
      return m.uptimeSec;
  }
}

export function compare(v: number, op: Op, t: number): boolean {
  switch (op) {
    case ">":
      return v > t;
    case "<":
      return v < t;
    case ">=":
      return v >= t;
    case "<=":
      return v <= t;
    case "==":
      return v === t;
    case "!=":
      return v !== t;
  }
}

export interface AlertTemplateContext {
  ruleName: string;
  metric: string;
  value: number;
  threshold: number;
  instanceName: string | null;
  instanceId: string | null;
}

export function renderTemplate(template: string | null, p: AlertTemplateContext): string {
  if (!template) return `${p.ruleName}: ${p.metric}=${p.value} (threshold ${p.threshold})`;
  return template
    .replace(/{{\s*instance\s*}}/g, p.instanceName ?? p.instanceId ?? "(none)")
    .replace(/{{\s*metric\s*}}/g, p.metric)
    .replace(/{{\s*value\s*}}/g, String(p.value))
    .replace(/{{\s*threshold\s*}}/g, String(p.threshold));
}

/**
 * Determine whether the latest probe samples satisfy the rule expression
 * continuously across the window. Returns `sustained: true` only when all
 * samples within `windowSec` match AND there are at least 2 samples.
 */
export function evaluateSamples(
  samples: { value: number; collectedAt: number }[],
  expr: RuleExpression,
  now: number,
): { latest: number; sustained: boolean } | null {
  if (samples.length === 0) return null;
  const cutoff = now - expr.windowSec * 1000;
  const recent = samples.filter((s) => s.collectedAt >= cutoff);
  if (recent.length === 0) return null;
  const latest = recent[0]!.value;
  const allMatch = recent.every((s) => compare(s.value, expr.op, expr.threshold));
  return { latest, sustained: allMatch && recent.length >= 2 };
}
