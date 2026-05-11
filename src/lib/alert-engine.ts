import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  alertRules,
  alertChannels,
  alertFirings,
  instances,
  probeSamples,
  auditLog,
  type AlertRuleRow,
  type AlertChannelRow,
} from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { deliverChannel, type ChannelConfig, type AlertPayload } from "@/lib/alert-channels";
import { publishEvent } from "@/lib/event-bus";
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

export interface RuleScope {
  accountIds?: string[];
  tagKey?: string;
  tagValue?: string;
}

function extractValue(m: ProbeMetrics, metric: MetricName): number {
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

function compare(v: number, op: Op, t: number): boolean {
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

interface ScopedInstance {
  id: string;
  name: string | null;
  displayName: string | null;
  accountId: string;
}

async function instancesForScope(scope: RuleScope | null): Promise<ScopedInstance[]> {
  let q = db
    .select({
      id: instances.id,
      name: instances.name,
      displayName: instances.displayName,
      accountId: instances.accountId,
    })
    .from(instances)
    .$dynamic();
  if (scope?.accountIds && scope.accountIds.length > 0) {
    q = q.where(sql`${instances.accountId} IN (${sql.join(scope.accountIds.map((id) => sql`${id}`), sql`,`)})`);
  }
  const rows = await q;
  // tag filter would require instance_tags join — keep simple for now.
  return rows;
}

async function lastSampleMatching(
  instanceId: string,
  expr: RuleExpression,
): Promise<{ value: number; sustained: boolean } | null> {
  // Pull samples within windowSec
  const cutoff = new Date(Date.now() - expr.windowSec * 1000);
  const rows = await db
    .select()
    .from(probeSamples)
    .where(and(eq(probeSamples.instanceId, instanceId), gte(probeSamples.collectedAt, cutoff)))
    .orderBy(desc(probeSamples.collectedAt))
    .limit(100);
  if (rows.length === 0) return null;
  const values = rows.map((r) => extractValue(JSON.parse(r.metricsJson) as ProbeMetrics, expr.metric));
  const latest = values[0]!;
  const allMatch = values.every((v) => compare(v, expr.op, expr.threshold));
  return { value: latest, sustained: allMatch && values.length >= 2 };
}

interface LoadedChannel {
  row: AlertChannelRow;
  config: ChannelConfig;
}

async function loadChannels(ids: string[]): Promise<LoadedChannel[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(alertChannels)
    .where(sql`${alertChannels.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`,`)})`);
  return rows
    .filter((r) => r.enabled)
    .map((row) => {
      const decoded = decryptJSON<unknown>(row.configEnc) as ChannelConfig["config"];
      return { row, config: { kind: row.kind as ChannelConfig["kind"], config: decoded } as ChannelConfig };
    });
}

async function inCooldown(ruleId: string, instanceId: string | null, cooldownSec: number): Promise<boolean> {
  if (cooldownSec <= 0) return false;
  const cutoff = new Date(Date.now() - cooldownSec * 1000);
  const rows = await db
    .select({ id: alertFirings.id })
    .from(alertFirings)
    .where(
      and(
        eq(alertFirings.ruleId, ruleId),
        instanceId ? eq(alertFirings.instanceId, instanceId) : sql`1=1`,
        gte(alertFirings.firedAt, cutoff),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function renderTemplate(template: string | null, p: AlertPayload): string {
  if (!template) return `${p.ruleName}: ${p.metric}=${p.value} (threshold ${p.threshold})`;
  return template
    .replace(/{{\s*instance\s*}}/g, p.instanceName ?? p.instanceId ?? "(none)")
    .replace(/{{\s*metric\s*}}/g, p.metric)
    .replace(/{{\s*value\s*}}/g, String(p.value))
    .replace(/{{\s*threshold\s*}}/g, String(p.threshold));
}

async function evaluateRule(rule: AlertRuleRow): Promise<void> {
  if (!rule.enabled) return;
  let expr: RuleExpression;
  let scope: RuleScope | null = null;
  let channelIds: string[];
  try {
    expr = JSON.parse(rule.expressionJson) as RuleExpression;
    if (rule.scopeJson) scope = JSON.parse(rule.scopeJson) as RuleScope;
    channelIds = JSON.parse(rule.channelsJson) as string[];
  } catch {
    return;
  }
  const cooldownSec = expr.cooldownSec ?? 600;

  const targets = await instancesForScope(scope);
  if (targets.length === 0) return;
  const channels = await loadChannels(channelIds);

  for (const inst of targets) {
    const r = await lastSampleMatching(inst.id, expr);
    if (!r || !r.sustained) continue;
    if (await inCooldown(rule.id, inst.id, cooldownSec)) continue;

    const payload: AlertPayload = {
      ruleName: rule.name,
      severity: (rule.severity as AlertPayload["severity"]) ?? "warning",
      message: "",
      metric: expr.metric,
      value: r.value,
      threshold: expr.threshold,
      instanceId: inst.id,
      instanceName: inst.displayName ?? inst.name,
      firedAt: Date.now(),
    };
    payload.message = renderTemplate(rule.messageTemplate, payload);

    const deliveries = await Promise.all(
      channels.map((c) => deliverChannel(c.row.name, c.config, payload)),
    );

    await db.insert(alertFirings).values({
      ruleId: rule.id,
      instanceId: inst.id,
      metric: expr.metric,
      value: r.value,
      threshold: expr.threshold,
      status: "firing",
      message: payload.message,
      deliveryJson: JSON.stringify(deliveries),
    });

    publishEvent({
      channel: "alert.fired",
      payload: {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: payload.severity,
        message: payload.message,
        instanceId: inst.id,
        metric: expr.metric,
        value: r.value,
        threshold: expr.threshold,
      },
    });
  }
}

let evaluating = false;

export async function evaluateAllRules(): Promise<void> {
  if (evaluating) return;
  evaluating = true;
  try {
    const rules = await db.select().from(alertRules).where(eq(alertRules.enabled, true));
    for (const r of rules) {
      try {
        await evaluateRule(r);
      } catch (err) {
        await db.insert(auditLog).values({
          action: "alert.evaluate",
          target: r.id,
          status: "error",
          message: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  } finally {
    evaluating = false;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __vmuiAlertScheduler__: { interval: ReturnType<typeof setInterval> } | undefined;
}

const TICK_MS = 60_000;

export function ensureAlertSchedulerRunning(): void {
  if (typeof window !== "undefined") return;
  if (globalThis.__vmuiAlertScheduler__) return;
  const interval = setInterval(() => {
    evaluateAllRules().catch((err) => console.error("[vmui] alert eval failed", err));
  }, TICK_MS);
  if (typeof interval.unref === "function") interval.unref();
  globalThis.__vmuiAlertScheduler__ = { interval };
  setTimeout(() => {
    evaluateAllRules().catch(() => {
      /* logged in audit */
    });
  }, 45_000);
}
