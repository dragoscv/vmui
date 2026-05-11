"use server";

import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, bootScripts } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";

const KINDS = ["cloud-init", "bash", "powershell"] as const;

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(280).optional().nullable(),
  kind: z.enum(KINDS),
  body: z.string().min(1).max(64 * 1024),
});

export async function listBootScriptsAction() {
  return db.select().from(bootScripts);
}

export async function upsertBootScriptAction(
  input: z.infer<typeof schema>,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { id, name, description, kind, body } = parsed.data;
  if (id) {
    await db
      .update(bootScripts)
      .set({ name, description: description ?? null, kind, body, updatedAt: new Date() })
      .where(eq(bootScripts.id, id));
    await db.insert(auditLog).values({ action: "boot-script.update", target: id, status: "ok" });
    revalidatePath("/settings");
    return { ok: true, id };
  }
  const newId = nanoid();
  await db.insert(bootScripts).values({
    id: newId,
    name,
    description: description ?? null,
    kind,
    body,
  });
  await db.insert(auditLog).values({ action: "boot-script.create", target: newId, status: "ok" });
  revalidatePath("/settings");
  return { ok: true, id: newId };
}

export async function deleteBootScriptAction(id: string): Promise<{ ok: boolean }> {
  try { await requireRole("operator"); } catch { return { ok: false }; }
  await db.delete(bootScripts).where(eq(bootScripts.id, id));
  await db.insert(auditLog).values({ action: "boot-script.delete", target: id, status: "ok" });
  revalidatePath("/settings");
  return { ok: true };
}
