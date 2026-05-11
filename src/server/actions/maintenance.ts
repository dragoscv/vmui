"use server";
import { db } from "@/lib/db";
import { auditLog, maintenanceWindows } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  mode: z.enum(["block", "warn"]).default("warn"),
  accountId: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});

export async function createMaintenanceWindowAction(input: z.infer<typeof createSchema>) {
  const user = await requireRole("admin");
  if (!user) return { ok: false, error: "Not authorized" };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = new Date(parsed.data.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return { ok: false, error: "Invalid date" };
  if (endsAt <= startsAt) return { ok: false, error: "End must be after start" };
  await db.insert(maintenanceWindows).values({
    id: nanoid(),
    name: parsed.data.name,
    startsAt,
    endsAt,
    mode: parsed.data.mode,
    accountId: parsed.data.accountId ?? null,
    reason: parsed.data.reason ?? null,
    createdBy: user.id,
  });
  await db.insert(auditLog).values({
    accountId: parsed.data.accountId ?? "system",
    action: "maintenance.window.create",
    target: parsed.data.name,
    status: "ok",
    message: `${parsed.data.mode} ${startsAt.toISOString()} → ${endsAt.toISOString()}`,
  });
  revalidatePath("/maintenance");
  return { ok: true };
}

export async function deleteMaintenanceWindowAction(id: string) {
  const user = await requireRole("admin");
  if (!user) return { ok: false, error: "Not authorized" };
  await db.delete(maintenanceWindows).where(eq(maintenanceWindows.id, id));
  revalidatePath("/maintenance");
  return { ok: true };
}
