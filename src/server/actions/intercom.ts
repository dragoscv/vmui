"use server";

import { requireDoorAccess, requireHomeActor, type HomeActor } from "@/lib/home/access";
import { armAutoOpen, ignoreCall, openDoor } from "@/lib/home/intercom";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Result = { ok: true } | { ok: false; error: string };

const source = (a: HomeActor) => (a.email ? `web:${a.email}` : "web");

async function guard(gate: () => Promise<HomeActor>, fn: (actor: HomeActor) => Promise<Result>): Promise<Result> {
  let actor: HomeActor;
  try {
    actor = await gate();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const r = await fn(actor);
  revalidatePath("/home");
  return r;
}

export async function armIntercomAction(minutes: number): Promise<Result> {
  const m = z.number().int().min(0).max(240).safeParse(minutes);
  if (!m.success) return { ok: false, error: "minute invalide" };
  return guard(requireDoorAccess, async (a) => {
    await armAutoOpen(m.data, source(a));
    return { ok: true };
  });
}

export async function openIntercomAction(): Promise<Result> {
  return guard(requireDoorAccess, async (a) => {
    const r = await openDoor(source(a));
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? "eșuat" };
  });
}

export async function ignoreIntercomAction(): Promise<Result> {
  return guard(requireHomeActor, async (a) => {
    await ignoreCall(source(a));
    return { ok: true };
  });
}
