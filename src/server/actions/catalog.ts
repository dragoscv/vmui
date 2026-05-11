"use server";

import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { auditLog, bootScripts } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { findTemplate } from "@/lib/catalog";
import { revalidatePath } from "next/cache";

export async function saveCatalogTemplateAction(
  templateId: string,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const tpl = findTemplate(templateId);
  if (!tpl) return { ok: false, error: "Unknown template" };

  const newId = nanoid();
  await db.insert(bootScripts).values({
    id: newId,
    name: `catalog: ${tpl.name}`,
    description: tpl.description.slice(0, 280),
    kind: "cloud-init",
    body: tpl.cloudInit,
  });
  await db.insert(auditLog).values({
    action: "catalog.save",
    target: tpl.id,
    status: "ok",
    message: `Saved ${tpl.name} cloud-init as boot script`,
  });
  revalidatePath("/settings");
  revalidatePath("/catalog");
  return { ok: true, id: newId };
}
