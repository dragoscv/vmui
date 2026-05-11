import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
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
import { extractValue, compare, renderTemplate as renderTemplateShared, type MetricName, type Op, type RuleExpression } from "@/lib/alert-eval";

export type { MetricName, Op, RuleExpression };

export interface RuleScope {
  accountIds?: string[];
  tagKey?: string;
  tagValue?: string;
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
  return renderTemplateShared(template, {
    ruleName: p.ruleName,
    metric: p.metric,
    value: p.value,
    threshold: p.threshold,
    instanceName: p.instanceName ?? null,
    instanceId: p.instanceId ?? null,
  });
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

  // Auto-resolve: any active firing for this rule whose latest sample no
  // longer matches the expression flips to "resolved" and re-dispatches.
  const active = await db
    .select()
    .from(alertFirings)
    .where(and(eq(alertFirings.ruleId, rule.id), eq(alertFirings.status, "firing"), isNull(alertFirings.resolvedAt)));
  for (const firing of active) {
    if (!firing.instanceId) continue;
    const latest = await db
      .select()
      .from(probeSamples)
      .where(eq(probeSamples.instanceId, firing.instanceId))
      .orderBy(desc(probeSamples.collectedAt))
      .limit(1);
    if (latest.length === 0) continue;
    const row = latest[0]!;
    const v = extractValue(JSON.parse(row.metricsJson) as ProbeMetrics, expr.metric);
    if (compare(v, expr.op, expr.threshold)) continue;
    const inst = targets.find((t) => t.id === firing.instanceId);
    const resolvedPayload: AlertPayload = {
      ruleName: rule.name,
      severity: "info",
      message: `[RESOLVED] ${rule.name}: ${expr.metric}=${v} is back under ${expr.threshold}`,
      metric: expr.metric,
      value: v,
      threshold: expr.threshold,
      instanceId: firing.instanceId,
      instanceName: inst?.displayName ?? inst?.name ?? null,
      firedAt: Date.now(),
    };
    const deliveries = await Promise.all(channels.map((c) => deliverChannel(c.row.name, c.config, resolvedPayload)));
    await db
      .update(alertFirings)
      .set({ status: "resolved", resolvedAt: new Date(), deliveryJson: JSON.stringify(deliveries) })
      .where(eq(alertFirings.id, firing.id));
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
