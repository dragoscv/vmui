"use server";

import { requireRole } from "@/lib/auth";
import { runDrDrill } from "@/lib/dr-drill";

export async function runDrDrillAction() {
  await requireRole("operator");
  try {
    const r = await runDrDrill();
    return { ok: true as const, result: r };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
