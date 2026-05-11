"use server";

import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, apiKeys } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { generateApiKey } from "@/lib/api-auth";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.enum(["operator", "viewer"]),
  rateLimitPerMinute: z.number().int().min(1).max(10_000).default(60),
});

export async function createApiKeyAction(
  input: z.infer<typeof createSchema>,
): Promise<{ ok: true; id: string; plaintext: string } | { ok: false; error: string }> {
  try {
    await requireRole("admin");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const id = nanoid();
  const { plaintext, hash } = await generateApiKey();
  await db.insert(apiKeys).values({
    id,
    name: parsed.data.name,
    hash,
    role: parsed.data.role,
    rateLimitPerMinute: parsed.data.rateLimitPerMinute,
  });
  await db.insert(auditLog).values({
    action: "api-key.create",
    target: id,
    status: "ok",
    message: `${parsed.data.name} (${parsed.data.role})`,
  });
  revalidatePath("/settings/api-keys");
  return { ok: true, id, plaintext };
}

export async function revokeApiKeyAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole("admin");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
  await db.insert(auditLog).values({
    action: "api-key.revoke",
    target: id,
    status: "ok",
  });
  revalidatePath("/settings/api-keys");
  return { ok: true };
}
