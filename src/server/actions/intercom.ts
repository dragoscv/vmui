"use server";

import { requireDoorAccess, requireHomeActor, type HomeActor } from "@/lib/home/access";
import { NO_CALL, armAutoOpen, ignoreCall, openDoor } from "@/lib/home/intercom";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Result = { ok: true } | { ok: false; error: string };

const source = (a: HomeActor) => (a.email ? `web:${a.email}` : "web");

async function guard(gate: () => Promise<HomeActor>, fn: (actor: HomeActor) => Promise<Result>): Promise<Result> {
  let actor: HomeActor;
  try {
    actor = await gate();
  } catch (err) {
    const t = await getTranslations("common");
    return { ok: false, error: err instanceof Error ? err.message : t("failed") };
  }
  const r = await fn(actor);
  revalidatePath("/home");
  return r;
}

export async function armIntercomAction(minutes: number): Promise<Result> {
  const m = z.number().int().min(0).max(240).safeParse(minutes);
  if (!m.success) return { ok: false, error: (await getTranslations("common"))("failed") };
  return guard(requireDoorAccess, async (a) => {
    await armAutoOpen(m.data, source(a));
    return { ok: true };
  });
}

export async function openIntercomAction(): Promise<Result> {
  return guard(requireDoorAccess, async (a) => {
    const r = await openDoor(source(a));
    if (r.ok) return { ok: true };
    const t = await getTranslations();
    return { ok: false, error: r.error === NO_CALL ? t("notify.errors.noCall") : (r.error ?? t("common.failed")) };
  });
}

export async function ignoreIntercomAction(): Promise<Result> {
  return guard(requireHomeActor, async (a) => {
    await ignoreCall(source(a));
    return { ok: true };
  });
}
