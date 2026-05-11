"use server";

import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { cloudAccounts, auditLog, probeSamples, instances } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { encryptJSON } from "@/lib/crypto";
import { probeInstance, type ProbeMetrics } from "@/lib/probe";

const uploadSchema = z.object({
  accountId: z.string().min(1),
  privateKey: z.string().min(64).max(32_000),
  passphrase: z.string().max(512).optional(),
  defaultUser: z
    .string()
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/u)
    .optional(),
});

export async function uploadProbeKeyAction(
  input: z.infer<typeof uploadSchema>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole("admin");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };

  if (!parsed.data.privateKey.includes("PRIVATE KEY")) {
    return { ok: false, error: "Not a PEM-formatted private key (must contain 'PRIVATE KEY')." };
  }

  const enc = encryptJSON({
    privateKey: parsed.data.privateKey,
    passphrase: parsed.data.passphrase,
    defaultUser: parsed.data.defaultUser,
  });
  await db
    .update(cloudAccounts)
    .set({ probeKeyEnc: enc, updatedAt: new Date() })
    .where(eq(cloudAccounts.id, parsed.data.accountId));
  await db.insert(auditLog).values({
    accountId: parsed.data.accountId,
    action: "probe.key.upload",
    target: parsed.data.accountId,
    status: "ok",
  });
  revalidatePath("/accounts");
  return { ok: true };
}

export async function clearProbeKeyAction(input: { accountId: string }): Promise<{ ok: boolean }> {
  try {
    await requireRole("admin");
  } catch {
    return { ok: false };
  }
  await db
    .update(cloudAccounts)
    .set({ probeKeyEnc: null, updatedAt: new Date() })
    .where(eq(cloudAccounts.id, input.accountId));
  await db.insert(auditLog).values({
    accountId: input.accountId,
    action: "probe.key.clear",
    target: input.accountId,
    status: "ok",
  });
  revalidatePath("/accounts");
  return { ok: true };
}

export async function probeInstanceAction(input: {
  instanceId: string;
}): Promise<{ ok: boolean; metrics?: ProbeMetrics; error?: string }> {
  try {
    await requireRole("viewer");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  try {
    const metrics = await probeInstance(input.instanceId);
    return { ok: true, metrics };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Probe failed" };
  }
}

const intervalSchema = z.object({
  instanceId: z.string().min(1),
  intervalSec: z.number().int().min(5).max(600).nullable(),
});

export async function setProbeIntervalAction(
  input: z.infer<typeof intervalSchema>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = intervalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid interval" };
  await db
    .update(instances)
    .set({ probeIntervalSec: parsed.data.intervalSec })
    .where(eq(instances.id, parsed.data.instanceId));
  revalidatePath(`/instances/${parsed.data.instanceId}`);
  return { ok: true };
}

export async function recentProbeSamples(
  instanceId: string,
  limit = 120,
): Promise<ProbeMetrics[]> {
  try {
    await requireRole("viewer");
  } catch {
    return [];
  }
  const rows = await db
    .select()
    .from(probeSamples)
    .where(eq(probeSamples.instanceId, instanceId))
    .orderBy(desc(probeSamples.collectedAt))
    .limit(limit);
  return rows.map((r) => JSON.parse(r.metricsJson) as ProbeMetrics).reverse();
}
