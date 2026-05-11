"use server";
import "server-only";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { runbooks, tagBudgets, idleParkPolicies, auditLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";

const id = () => randomBytes(8).toString("hex");

const upsertRunbookSchema = z.object({
  id: z.string().optional(),
  accountId: z.string().optional().nullable(),
  providerInstanceId: z.string().optional().nullable(),
  title: z.string().min(1).max(200),
  body: z.string().max(50_000),
});

export async function upsertRunbookAction(input: z.input<typeof upsertRunbookSchema>) {
  await requireRole("operator");
  const data = upsertRunbookSchema.parse(input);
  const now = new Date();
  if (data.id) {
    await db.update(runbooks).set({ title: data.title, body: data.body, updatedAt: now }).where(eq(runbooks.id, data.id));
  } else {
    await db.insert(runbooks).values({
      id: id(),
      accountId: data.accountId ?? null,
      providerInstanceId: data.providerInstanceId ?? null,
      title: data.title,
      body: data.body,
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.insert(auditLog).values({ action: "runbook.upsert", target: data.title, status: "ok" });
  revalidatePath("/runbooks");
  return { ok: true as const };
}

export async function deleteRunbookAction(id: string) {
  await requireRole("operator");
  await db.delete(runbooks).where(eq(runbooks.id, id));
  await db.insert(auditLog).values({ action: "runbook.delete", target: id, status: "ok" });
  revalidatePath("/runbooks");
  return { ok: true as const };
}

const tagBudgetSchema = z.object({
  id: z.string().optional(),
  tagKey: z.string().min(1).max(64),
  tagValue: z.string().min(1).max(128),
  monthlyUsd: z.number().positive().max(1_000_000),
});

export async function upsertTagBudgetAction(input: z.input<typeof tagBudgetSchema>) {
  await requireRole("operator");
  const d = tagBudgetSchema.parse(input);
  if (d.id) {
    await db.update(tagBudgets).set({
      tagKey: d.tagKey, tagValue: d.tagValue, monthlyUsd: d.monthlyUsd,
    }).where(eq(tagBudgets.id, d.id));
  } else {
    await db.insert(tagBudgets).values({
      id: id(), tagKey: d.tagKey, tagValue: d.tagValue, monthlyUsd: d.monthlyUsd,
    });
  }
  await db.insert(auditLog).values({ action: "tagBudget.upsert", target: `${d.tagKey}:${d.tagValue}`, status: "ok" });
  revalidatePath("/budgets");
  return { ok: true as const };
}

export async function deleteTagBudgetAction(id: string) {
  await requireRole("operator");
  await db.delete(tagBudgets).where(eq(tagBudgets.id, id));
  revalidatePath("/budgets");
  return { ok: true as const };
}

const idleParkSchema = z.object({
  accountId: z.string().min(1),
  providerInstanceId: z.string().min(1),
  cpuPct: z.number().int().min(1).max(50).default(5),
  netKbps: z.number().int().min(1).max(10_000).default(50),
  windowMin: z.number().int().min(5).max(720).default(30),
  enabled: z.boolean().default(true),
});

export async function setIdleParkPolicyAction(input: z.input<typeof idleParkSchema>) {
  await requireRole("operator");
  const d = idleParkSchema.parse(input);
  const existing = (
    await db.select().from(idleParkPolicies)
      .where(eq(idleParkPolicies.providerInstanceId, d.providerInstanceId))
      .limit(1)
  )[0];
  if (existing) {
    await db.update(idleParkPolicies).set({
      cpuPct: d.cpuPct, netKbps: d.netKbps, windowMin: d.windowMin, enabled: d.enabled ? 1 : 0,
    }).where(eq(idleParkPolicies.id, existing.id));
  } else {
    await db.insert(idleParkPolicies).values({
      id: id(), accountId: d.accountId, providerInstanceId: d.providerInstanceId,
      cpuPct: d.cpuPct, netKbps: d.netKbps, windowMin: d.windowMin, enabled: d.enabled ? 1 : 0,
    });
  }
  await db.insert(auditLog).values({ accountId: d.accountId, action: "idle.park.config", target: d.providerInstanceId, status: "ok" });
  revalidatePath("/auto-park");
  return { ok: true as const };
}

export async function disableIdleParkAction(id: string) {
  await requireRole("operator");
  await db.update(idleParkPolicies).set({ enabled: 0 }).where(eq(idleParkPolicies.id, id));
  revalidatePath("/auto-park");
  return { ok: true as const };
}
