"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { secrets, secretReveals, auditLog } from "@/lib/db/schema";
import { requireRole, getCurrentUser } from "@/lib/auth";
import {
  createSecret,
  revealSecret,
  rotateSecret,
  pushSecretToInstance,
  exportSealedSecret,
} from "@/lib/secrets";

const createSchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/, "letters, digits, _ or -"),
  kind: z.enum(["db", "api-key", "password", "generic"]),
  value: z.string().min(1),
  rotationDays: z.coerce.number().int().min(0).max(3650).optional(),
  sealed: z.coerce.boolean().optional(),
});

export async function createSecretAction(input: z.infer<typeof createSchema>) {
  await requireRole("operator");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  const id = createSecret(parsed.data);
  revalidatePath("/secrets");
  return { ok: true as const, id };
}

export async function deleteSecretAction(id: string) {
  await requireRole("operator");
  db.delete(secrets).where(eq(secrets.id, id)).run();
  db.insert(auditLog).values({ action: "secret.delete", target: id, status: "ok" }).run();
  revalidatePath("/secrets");
  return { ok: true as const };
}

export async function revealSecretAction(id: string) {
  await requireRole("operator");
  const user = await getCurrentUser();
  const v = revealSecret(id, { userId: user?.id ?? null, ip: null });
  if (!v) return { ok: false as const, error: "not found" };
  return { ok: true as const, value: v.value, meta: v.meta ?? {} };
}

export async function rotateSecretAction(id: string) {
  await requireRole("operator");
  const v = rotateSecret(id);
  if (!v) return { ok: false as const, error: "not found" };
  revalidatePath("/secrets");
  return { ok: true as const, value: v.value };
}

export async function pushSecretToInstanceAction(
  secretId: string,
  instanceId: string,
  envFilePath: string,
) {
  await requireRole("operator");
  const r = await pushSecretToInstance(secretId, instanceId, envFilePath);
  return r.ok ? { ok: true as const, message: r.message } : { ok: false as const, error: r.message };
}

export async function exportSealedSecretAction(id: string, passphrase: string) {
  await requireRole("operator");
  if (passphrase.length < 8) return { ok: false as const, error: "passphrase must be ≥ 8 chars" };
  const r = exportSealedSecret(id, passphrase);
  if (!r) return { ok: false as const, error: "not found" };
  return { ok: true as const, filename: r.filename, body: r.body };
}

export async function listSecretsAction() {
  await requireRole("viewer");
  const rows = db.select({
    id: secrets.id,
    name: secrets.name,
    kind: secrets.kind,
    rotationDays: secrets.rotationDays,
    lastRotatedAt: secrets.lastRotatedAt,
    sealed: secrets.sealed,
    createdAt: secrets.createdAt,
  }).from(secrets).orderBy(desc(secrets.createdAt)).all();
  return rows;
}

export async function listSecretRevealsAction(secretId: string) {
  await requireRole("operator");
  return db
    .select()
    .from(secretReveals)
    .where(eq(secretReveals.secretId, secretId))
    .orderBy(desc(secretReveals.at))
    .limit(50)
    .all();
}
