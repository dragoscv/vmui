"use server";

import { LOCALE_COOKIE, isLocale, type Locale } from "@/i18n/config";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
