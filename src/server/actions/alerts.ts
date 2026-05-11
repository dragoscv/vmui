"use server";

import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { alertChannels, alertRules, alertFirings, auditLog } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { encryptJSON } from "@/lib/crypto";
import { deliverChannel, type ChannelConfig, type AlertPayload } from "@/lib/alert-channels";
import { evaluateAllRules } from "@/lib/alert-engine";

const discordSchema = z.object({ kind: z.literal("discord"), webhookUrl: z.string().url(), username: z.string().max(64).optional() });
const slackSchema = z.object({ kind: z.literal("slack"), webhookUrl: z.string().url(), channel: z.string().max(64).optional() });
const ntfySchema = z.object({
  kind: z.literal("ntfy"),
  baseUrl: z.string().url(),
  topic: z.string().min(1).max(64),
  token: z.string().max(256).optional(),
  priority: z.number().int().min(1).max(5).optional(),
});
const webhookSchema = z.object({
  kind: z.literal("webhook"),
  url: z.string().url(),
  hmacSecret: z.string().max(256).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
const smtpSchema = z.object({
  kind: z.literal("smtp"),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().optional(),
  username: z.string().max(255).optional(),
  password: z.string().max(255).optional(),
  from: z.string().email(),
  to: z.string().email(),
});
const toastSchema = z.object({ kind: z.literal("toast"), level: z.enum(["info", "warning", "critical"]).optional() });

const channelInputSchema = z.discriminatedUnion("kind", [
  toastSchema,
  discordSchema,
  slackSchema,
  ntfySchema,
  webhookSchema,
  smtpSchema,
]);

const createChannelSchema = z.object({
  name: z.string().min(1).max(64),
  channel: channelInputSchema,
});

export async function createAlertChannelAction(
  input: z.infer<typeof createChannelSchema>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    await requireRole("admin");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = createChannelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  const id = randomUUID();
  const { kind, ...config } = parsed.data.channel;
  const enc = encryptJSON(config);
  await db.insert(alertChannels).values({
    id,
    name: parsed.data.name,
    kind,
    configEnc: enc,
    enabled: true,
  });
  await db.insert(auditLog).values({ action: "alert.channel.create", target: id, status: "ok", message: parsed.data.name });
  revalidatePath("/alerts");
  return { ok: true, id };
}

export async function deleteAlertChannelAction(input: { id: string }): Promise<{ ok: boolean }> {
  try {
    await requireRole("admin");
  } catch {
    return { ok: false };
  }
  await db.delete(alertChannels).where(eq(alertChannels.id, input.id));
  await db.insert(auditLog).values({ action: "alert.channel.delete", target: input.id, status: "ok" });
  revalidatePath("/alerts");
  return { ok: true };
}

export async function testAlertChannelAction(input: { id: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole("admin");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const row = await db.query.alertChannels.findFirst({ where: eq(alertChannels.id, input.id) });
  if (!row) return { ok: false, error: "Channel not found" };
  const { decryptJSON } = await import("@/lib/crypto");
  const cfg = { kind: row.kind, config: decryptJSON(row.configEnc) } as ChannelConfig;
  const payload: AlertPayload = {
    ruleName: "Test rule",
    severity: "info",
    message: "This is a vmui test alert. If you see this, the channel is working.",
    metric: "cpu",
    value: 99,
    threshold: 80,
    instanceId: null,
    instanceName: "test-instance",
    firedAt: Date.now(),
  };
  const out = await deliverChannel(row.name, cfg, payload);
  return out.ok ? { ok: true } : { ok: false, error: out.error };
}

const exprSchema = z.object({
  metric: z.enum(["cpu", "mem", "disk", "net_in", "net_out", "load1", "uptime"]),
  op: z.enum([">", "<", ">=", "<=", "==", "!="]),
  threshold: z.number(),
  windowSec: z.number().int().min(10).max(3600),
  cooldownSec: z.number().int().min(0).max(86400).optional(),
});

const scopeSchema = z
  .object({
    accountIds: z.array(z.string()).optional(),
    tagKey: z.string().optional(),
    tagValue: z.string().optional(),
  })
  .optional()
  .nullable();

const createRuleSchema = z.object({
  name: z.string().min(1).max(120),
  severity: z.enum(["info", "warning", "critical"]).default("warning"),
  enabled: z.boolean().default(true),
  expression: exprSchema,
  scope: scopeSchema,
  channelIds: z.array(z.string()).min(1),
  messageTemplate: z.string().max(500).optional(),
});

export async function createAlertRuleAction(
  input: z.infer<typeof createRuleSchema>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = createRuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  const id = randomUUID();
  await db.insert(alertRules).values({
    id,
    name: parsed.data.name,
    severity: parsed.data.severity,
    enabled: parsed.data.enabled,
    expressionJson: JSON.stringify(parsed.data.expression),
    scopeJson: parsed.data.scope ? JSON.stringify(parsed.data.scope) : null,
    channelsJson: JSON.stringify(parsed.data.channelIds),
    messageTemplate: parsed.data.messageTemplate ?? null,
  });
  await db.insert(auditLog).values({ action: "alert.rule.create", target: id, status: "ok", message: parsed.data.name });
  revalidatePath("/alerts");
  return { ok: true, id };
}

export async function toggleAlertRuleAction(input: { id: string; enabled: boolean }): Promise<{ ok: boolean }> {
  try {
    await requireRole("operator");
  } catch {
    return { ok: false };
  }
  await db.update(alertRules).set({ enabled: input.enabled, updatedAt: new Date() }).where(eq(alertRules.id, input.id));
  revalidatePath("/alerts");
  return { ok: true };
}

export async function deleteAlertRuleAction(input: { id: string }): Promise<{ ok: boolean }> {
  try {
    await requireRole("operator");
  } catch {
    return { ok: false };
  }
  await db.delete(alertRules).where(eq(alertRules.id, input.id));
  await db.insert(auditLog).values({ action: "alert.rule.delete", target: input.id, status: "ok" });
  revalidatePath("/alerts");
  return { ok: true };
}

export async function evaluateRulesNowAction(): Promise<{ ok: boolean }> {
  try {
    await requireRole("operator");
  } catch {
    return { ok: false };
  }
  await evaluateAllRules();
  revalidatePath("/alerts");
  return { ok: true };
}

export async function listRecentFiringsAction(limit = 50) {
  try {
    await requireRole("viewer");
  } catch {
    return [];
  }
  const rows = await db
    .select()
    .from(alertFirings)
    .orderBy(desc(alertFirings.firedAt))
    .limit(limit);
  return rows;
}
