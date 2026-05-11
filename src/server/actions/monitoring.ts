"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { deployNodeExporter, generatePromConfig } from "@/lib/monitoring";

export async function deployNodeExporterAction(instanceId: string) {
  await requireRole("operator");
  const r = await deployNodeExporter(instanceId);
  revalidatePath("/monitoring");
  return r.ok ? { ok: true as const, url: r.url, message: r.message } : { ok: false as const, error: r.message };
}

export async function generatePromConfigAction() {
  await requireRole("viewer");
  const yaml = await generatePromConfig();
  return { ok: true as const, yaml };
}
