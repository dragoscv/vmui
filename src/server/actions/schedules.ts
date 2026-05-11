"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { schedules, instances, auditLog } from "@/lib/db/schema";
import { isValidCron } from "@/lib/cron";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";

const createSchema = z.object({
  instanceId: z.string().min(1),
  cron: z.string().min(3).max(64).refine(isValidCron, "Invalid cron expression"),
  action: z.enum(["start", "stop", "reboot", "snapshot"]),
  label: z.string().max(80).optional(),
});

export async function createScheduleAction(input: z.infer<typeof createSchema>) {
  try { await requireRole("operator"); } catch (err) { return { ok: false as const, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const inst = (
    await db.select().from(instances).where(eq(instances.id, parsed.data.instanceId)).limit(1)
  )[0];
  if (!inst) return { ok: false as const, error: "Instance not found." };

  const id = nanoid(12);
  await db.insert(schedules).values({
    id,
    instanceId: inst.id,
    accountId: inst.accountId,
    cron: parsed.data.cron,
    action: parsed.data.action,
    enabled: true,
    label: parsed.data.label ?? null,
  });
  await db.insert(auditLog).values({
    accountId: inst.accountId,
    action: "schedule.create",
    target: inst.providerInstanceId,
    status: "ok",
    message: `${parsed.data.action} @ "${parsed.data.cron}"`,
  });
  revalidatePath(`/instances/${inst.id}`);
  revalidatePath("/schedules");
  return { ok: true as const, id };
}

export async function setScheduleEnabledAction(id: string, enabled: boolean) {
  try { await requireRole("operator"); } catch { return { ok: false as const }; }
  await db.update(schedules).set({ enabled }).where(eq(schedules.id, id));
  revalidatePath("/schedules");
  return { ok: true as const };
}

export async function deleteScheduleAction(id: string) {
  try { await requireRole("operator"); } catch { return { ok: false as const }; }
  await db.delete(schedules).where(eq(schedules.id, id));
  revalidatePath("/schedules");
  return { ok: true as const };
}
