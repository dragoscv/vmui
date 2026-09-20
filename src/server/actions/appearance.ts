"use server";

import { appearanceSchema, type Appearance } from "@/lib/appearance/model";
import { saveUserAppearance } from "@/lib/appearance/server";

/** Persist the signed-in user's appearance. The cookie/localStorage copy is written client-side. */
export async function saveAppearanceAction(input: Appearance): Promise<{ ok: boolean }> {
  const p = appearanceSchema.safeParse(input);
  if (!p.success) return { ok: false };
  await saveUserAppearance(p.data);
  return { ok: true };
}
