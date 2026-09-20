import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { APPEARANCE_COOKIE, APPEARANCE_DEFAULTS, parseAppearance, type Appearance } from "./model";

/** Cookie first (it is what the browser last rendered, zero flash), then the user's row, then defaults. */
export async function resolveAppearance(): Promise<Appearance> {
  const jar = await cookies();
  const c = jar.get(APPEARANCE_COOKIE)?.value;
  if (c) return parseAppearance(decodeURIComponent(c));
  const u = await getCurrentUser().catch(() => null);
  if (u?.preferences) return parseAppearance(u.preferences);
  return APPEARANCE_DEFAULTS;
}

export async function saveUserAppearance(a: Appearance): Promise<void> {
  const u = await getCurrentUser().catch(() => null);
  if (!u) return;
  await db.update(users).set({ preferences: JSON.stringify(a) }).where(eq(users.id, u.id));
}
