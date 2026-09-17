"use server";

import { requireRole } from "@/lib/auth";
import { armAutoOpen, ignoreCall, openDoor } from "@/lib/home/intercom";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Result = { ok: true } | { ok: false; error: string };

async function guard(fn: () => Promise<Result>): Promise<Result> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const r = await fn();
  revalidatePath("/home");
  return r;
}

export async function armIntercomAction(minutes: number): Promise<Result> {
  const m = z.number().int().min(0).max(240).safeParse(minutes);
  if (!m.success) return { ok: false, error: "minute invalide" };
  return guard(async () => {
    await armAutoOpen(m.data, "web");
    return { ok: true };
  });
}

export async function openIntercomAction(): Promise<Result> {
  return guard(async () => {
    const r = await openDoor("web");
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? "eșuat" };
  });
}

export async function ignoreIntercomAction(): Promise<Result> {
  return guard(async () => {
    await ignoreCall("web");
    return { ok: true };
  });
}
