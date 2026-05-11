"use server";

import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";

const schema = z.object({
  accountId: z.string().min(1),
  monthlyUsd: z.number().min(0).max(1_000_000).nullable(),
});

export async function updateMonthlyBudgetAction(
  input: z.infer<typeof schema>,
): Promise<{ ok: boolean; error?: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  await db
    .update(cloudAccounts)
    .set({ monthlyBudgetUsd: parsed.data.monthlyUsd })
    .where(eq(cloudAccounts.id, parsed.data.accountId));
  await db.insert(auditLog).values({
    accountId: parsed.data.accountId,
    action: "account.budget.update",
    status: "ok",
    message: parsed.data.monthlyUsd == null ? "(cleared)" : `$${parsed.data.monthlyUsd}/mo`,
  });
  revalidatePath("/accounts");
  return { ok: true };
}
