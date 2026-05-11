"use server";

import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";

const reqTagsSchema = z.object({
  accountId: z.string().min(1),
  keys: z.array(z.string().trim().min(1).max(64)).max(32),
});

export async function updateRequiredTagsAction(
  input: z.infer<typeof reqTagsSchema>,
): Promise<{ ok: boolean; error?: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = reqTagsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const deduped = Array.from(new Set(parsed.data.keys));
  await db
    .update(cloudAccounts)
    .set({ requiredTags: deduped.length === 0 ? null : JSON.stringify(deduped) })
    .where(eq(cloudAccounts.id, parsed.data.accountId));
  await db.insert(auditLog).values({
    accountId: parsed.data.accountId,
    action: "account.required-tags.update",
    status: "ok",
    message: deduped.length === 0 ? "(cleared)" : deduped.join(","),
  });
  revalidatePath("/accounts");
  revalidatePath("/compliance");
  return { ok: true };
}

const vcpuSchema = z.object({
  accountId: z.string().min(1),
  vcpu: z.number().int().min(0).max(100_000).nullable(),
});

export async function updateVcpuQuotaAction(
  input: z.infer<typeof vcpuSchema>,
): Promise<{ ok: boolean; error?: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = vcpuSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  await db
    .update(cloudAccounts)
    .set({ vcpuQuota: parsed.data.vcpu === 0 ? null : parsed.data.vcpu })
    .where(eq(cloudAccounts.id, parsed.data.accountId));
  await db.insert(auditLog).values({
    accountId: parsed.data.accountId,
    action: "account.vcpu-quota.update",
    status: "ok",
    message: parsed.data.vcpu == null ? "(cleared)" : `${parsed.data.vcpu} vCPU`,
  });
  revalidatePath("/accounts");
  return { ok: true };
}

const safeTerminateSchema = z.object({
  accountId: z.string().min(1),
  enabled: z.boolean(),
});

export async function updateSafeTerminateAction(
  input: z.infer<typeof safeTerminateSchema>,
): Promise<{ ok: boolean; error?: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = safeTerminateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  await db
    .update(cloudAccounts)
    .set({ safeTerminate: parsed.data.enabled })
    .where(eq(cloudAccounts.id, parsed.data.accountId));
  await db.insert(auditLog).values({
    accountId: parsed.data.accountId,
    action: "account.safe-terminate.update",
    status: "ok",
    message: parsed.data.enabled ? "enabled" : "disabled",
  });
  revalidatePath("/accounts");
  return { ok: true };
}

const autoTagRulesSchema = z.object({
  accountId: z.string().min(1),
  rules: z
    .array(
      z.object({
        pattern: z.string().trim().min(1).max(256),
        tags: z.record(z.string().min(1).max(64), z.string().max(256)),
      }),
    )
    .max(64),
});

export async function updateAutoTagRulesAction(
  input: z.infer<typeof autoTagRulesSchema>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = autoTagRulesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  for (const r of parsed.data.rules) {
    try {
      new RegExp(r.pattern);
    } catch {
      return { ok: false, error: `Invalid regex: ${r.pattern}` };
    }
  }
  await db
    .update(cloudAccounts)
    .set({ autoTagRules: parsed.data.rules.length === 0 ? null : JSON.stringify(parsed.data.rules) })
    .where(eq(cloudAccounts.id, parsed.data.accountId));
  await db.insert(auditLog).values({
    accountId: parsed.data.accountId,
    action: "account.auto-tag-rules.update",
    status: "ok",
    message: `${parsed.data.rules.length} rule(s)`,
  });
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.data.accountId}`);
  return { ok: true };
}
