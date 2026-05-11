"use server";
import "server-only";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { stickyNotes, autoTagRules, auditLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";

const newId = () => randomBytes(8).toString("hex");

const noteSchema = z.object({
  id: z.string().optional(),
  accountId: z.string().min(1),
  providerInstanceId: z.string().min(1),
  body: z.string().min(1).max(2000),
  color: z.enum(["amber", "rose", "emerald", "sky", "violet"]).default("amber"),
});

export async function upsertStickyNoteAction(input: z.input<typeof noteSchema>) {
  const me = await requireRole("operator");
  const d = noteSchema.parse(input);
  if (d.id) {
    await db.update(stickyNotes).set({ body: d.body, color: d.color }).where(eq(stickyNotes.id, d.id));
  } else {
    await db.insert(stickyNotes).values({
      id: newId(),
      accountId: d.accountId,
      providerInstanceId: d.providerInstanceId,
      body: d.body,
      color: d.color,
      createdAt: new Date(),
      createdBy: me?.id ?? null,
    });
  }
  await db.insert(auditLog).values({ accountId: d.accountId, action: "sticky.upsert", target: d.providerInstanceId, status: "ok" });
  revalidatePath(`/instances/${d.accountId}/${encodeURIComponent(d.providerInstanceId)}`);
  return { ok: true as const };
}

export async function deleteStickyNoteAction(id: string) {
  await requireRole("operator");
  const [row] = await db.select().from(stickyNotes).where(eq(stickyNotes.id, id)).limit(1);
  await db.delete(stickyNotes).where(eq(stickyNotes.id, id));
  await db.insert(auditLog).values({ action: "sticky.delete", target: id, status: "ok" });
  if (row) revalidatePath(`/instances/${row.accountId}/${encodeURIComponent(row.providerInstanceId)}`);
  return { ok: true as const };
}

const ruleSchema = z.object({
  id: z.string().optional(),
  namePattern: z.string().min(1).max(200).refine((v) => {
    try { new RegExp(v); return true; } catch { return false; }
  }, "Invalid regex"),
  tagKey: z.string().min(1).max(64),
  tagValue: z.string().min(1).max(128),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(10000).default(100),
});

export async function upsertAutoTagRuleAction(input: z.input<typeof ruleSchema>) {
  await requireRole("admin");
  const d = ruleSchema.parse(input);
  if (d.id) {
    await db.update(autoTagRules).set({
      namePattern: d.namePattern, tagKey: d.tagKey, tagValue: d.tagValue,
      enabled: d.enabled ? 1 : 0, priority: d.priority,
    }).where(eq(autoTagRules.id, d.id));
  } else {
    await db.insert(autoTagRules).values({
      id: newId(),
      namePattern: d.namePattern,
      tagKey: d.tagKey,
      tagValue: d.tagValue,
      enabled: d.enabled ? 1 : 0,
      priority: d.priority,
      createdAt: new Date(),
    });
  }
  await db.insert(auditLog).values({ action: "auto-tag.upsert", target: `${d.tagKey}=${d.tagValue}`, status: "ok" });
  revalidatePath("/auto-tag");
  return { ok: true as const };
}

export async function deleteAutoTagRuleAction(id: string) {
  await requireRole("admin");
  await db.delete(autoTagRules).where(eq(autoTagRules.id, id));
  await db.insert(auditLog).values({ action: "auto-tag.delete", target: id, status: "ok" });
  revalidatePath("/auto-tag");
  return { ok: true as const };
}
