"use server";
import { runCisChecks } from "@/lib/cis-linux";
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function runCisCheckAction(input: { accountId: string; providerInstanceId: string }) {
  const user = await requireRole("operator");
  if (!user) return { ok: false as const, error: "Not authorized" };
  try {
    const stats = await runCisChecks(input);
    revalidatePath("/cis");
    return { ok: true as const, stats };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "scan failed" };
  }
}
