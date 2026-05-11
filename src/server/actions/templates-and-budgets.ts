"use server";
import "server-only";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { launchTemplates, accountBudgets, instances, snapshotHistory, auditLog } from "@/lib/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { notify } from "@/lib/notifications";

const newId = () => randomBytes(8).toString("hex");

/* ---------- Launch templates ---------- */

const tplSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  accountId: z.string().min(1),
  region: z.string().min(1),
  instanceType: z.string().min(1),
  platform: z.enum(["linux", "windows", "macos"]),
  configJson: z.string().min(2).max(50_000),
});

export async function createLaunchTemplateAction(input: z.input<typeof tplSchema>) {
  const me = await requireRole("operator");
  const d = tplSchema.parse(input);
  const id = newId();
  await db.insert(launchTemplates).values({
    id, name: d.name, description: d.description ?? null,
    accountId: d.accountId, region: d.region,
    instanceType: d.instanceType, platform: d.platform,
    configJson: d.configJson,
    createdAt: new Date(), createdBy: me?.id ?? null,
  });
  await db.insert(auditLog).values({ accountId: d.accountId, action: "template.create", target: d.name, status: "ok" });
  revalidatePath("/templates");
  return { ok: true as const, id };
}

export async function deleteLaunchTemplateAction(id: string) {
  await requireRole("operator");
  await db.delete(launchTemplates).where(eq(launchTemplates.id, id));
  await db.insert(auditLog).values({ action: "template.delete", target: id, status: "ok" });
  revalidatePath("/templates");
  return { ok: true as const };
}

/** Save the current config of an existing instance as a template. */
export async function saveInstanceAsTemplateAction(input: { instanceId: string; name: string; description?: string }) {
  const me = await requireRole("operator");
  const [inst] = await db.select().from(instances).where(eq(instances.id, input.instanceId)).limit(1);
  if (!inst) return { ok: false as const, error: "Instance not found" };
  if (!inst.instanceType) return { ok: false as const, error: "Instance has no recorded type" };

  const id = newId();
  const config = {
    name: inst.name ?? inst.providerInstanceId,
    region: inst.region,
    instanceType: inst.instanceType,
    platform: inst.platform,
    raw: inst.rawJson ? JSON.parse(inst.rawJson) : {},
  };
  await db.insert(launchTemplates).values({
    id, name: input.name, description: input.description ?? null,
    accountId: inst.accountId, region: inst.region,
    instanceType: inst.instanceType, platform: inst.platform,
    configJson: JSON.stringify(config),
    createdAt: new Date(), createdBy: me?.id ?? null,
  });
  await db.insert(auditLog).values({ accountId: inst.accountId, action: "template.save-from-instance", target: input.name, status: "ok" });
  revalidatePath("/templates");
  return { ok: true as const, id };
}

/* ---------- Per-account budgets ---------- */

const budgetSchema = z.object({
  accountId: z.string().min(1),
  monthlyUsd: z.number().nonnegative().max(10_000_000),
});

export async function setAccountBudgetAction(input: z.input<typeof budgetSchema>) {
  await requireRole("admin");
  const d = budgetSchema.parse(input);
  const [existing] = await db.select().from(accountBudgets).where(eq(accountBudgets.accountId, d.accountId)).limit(1);
  if (existing) {
    await db.update(accountBudgets).set({ monthlyUsd: d.monthlyUsd, alertedAt: null }).where(eq(accountBudgets.accountId, d.accountId));
  } else {
    await db.insert(accountBudgets).values({ accountId: d.accountId, monthlyUsd: d.monthlyUsd, createdAt: new Date() });
  }
  await db.insert(auditLog).values({ accountId: d.accountId, action: "budget.set", target: `${d.monthlyUsd} usd/mo`, status: "ok" });
  revalidatePath("/account-budgets");
  return { ok: true as const };
}

export async function deleteAccountBudgetAction(accountId: string) {
  await requireRole("admin");
  await db.delete(accountBudgets).where(eq(accountBudgets.accountId, accountId));
  revalidatePath("/account-budgets");
  return { ok: true as const };
}

export async function checkAccountBudgets(): Promise<{ alerted: number }> {
  const budgets = await db.select().from(accountBudgets);
  if (budgets.length === 0) return { alerted: 0 };
  const since = new Date(Date.now() - 24 * 3600_000);
  let alerted = 0;
  for (const b of budgets) {
    if (b.monthlyUsd <= 0) continue;
    const [latest] = await db.select().from(snapshotHistory)
      .where(and(eq(snapshotHistory.accountId, b.accountId), gte(snapshotHistory.capturedAt, since)))
      .limit(1);
    if (!latest) continue;
    const projectedMonthly = latest.hourlyUsd * 24 * 30;
    if (projectedMonthly < b.monthlyUsd * 0.8) continue;
    if (b.alertedAt && Date.now() - b.alertedAt.getTime() < 24 * 3600_000) continue;
    await notify({
      severity: "warning",
      category: "cost",
      title: `Account approaching budget: ${b.accountId.slice(0, 8)}…`,
      body: `Projected monthly $${projectedMonthly.toFixed(2)} vs cap $${b.monthlyUsd.toFixed(2)}`,
      accountId: b.accountId,
    });
    await db.update(accountBudgets).set({ alertedAt: new Date() }).where(eq(accountBudgets.accountId, b.accountId));
    alerted++;
  }
  return { alerted };
}
