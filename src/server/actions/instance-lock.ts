"use server";

import "server-only";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, instances } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";

const schema = z.object({
  accountId: z.string().min(1),
  region: z.string().min(1),
  providerInstanceId: z.string().min(1),
  locked: z.boolean(),
});

export async function setTerminationLockAction(
  input: z.infer<typeof schema>,
): Promise<{ ok: boolean; error?: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  await db
    .update(instances)
    .set({ terminationLocked: parsed.data.locked })
    .where(
      and(
        eq(instances.accountId, parsed.data.accountId),
        eq(instances.region, parsed.data.region),
        eq(instances.providerInstanceId, parsed.data.providerInstanceId),
      ),
    );
  await db.insert(auditLog).values({
    accountId: parsed.data.accountId,
    action: parsed.data.locked ? "instance.lock" : "instance.unlock",
    target: parsed.data.providerInstanceId,
    status: "ok",
  });
  revalidatePath("/");
  revalidatePath(`/instances/${encodeURIComponent(parsed.data.providerInstanceId)}`);
  return { ok: true };
}
