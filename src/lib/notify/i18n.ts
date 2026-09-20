import { DEFAULT_LOCALE, isLocale, localeFromAcceptLanguage, type Locale } from "@/i18n/config";
import { createTranslator } from "next-intl";
import "server-only";

// Cards are stored language-neutral: a text field is either a literal string
// or a message reference `{ key, params }` into the `notify` namespace. Every
// consumer renders at delivery time for ITS language — the phone that
// registered with Accept-Language ro, the web tab with the ro cookie, the HA
// fallback with the settings language — so one card reads right everywhere.

export type Msg = { key: string; params?: Record<string, string | number> };
export type Text = string | Msg;

export const msg = (key: string, params?: Record<string, string | number>): Msg => (params ? { key, params } : { key });
export const isMsg = (t: unknown): t is Msg => typeof t === "object" && t !== null && typeof (t as Msg).key === "string";

const cache = new Map<Locale, Promise<ReturnType<typeof createTranslator>>>();

async function translator(locale: Locale) {
  let p = cache.get(locale);
  if (!p) {
    p = (async () => {
      const messages = (await import(`../../../messages/notify/${locale}.json`)).default as Record<string, unknown>;
      return createTranslator({ locale, messages: { notify: messages }, namespace: "notify", onError: () => undefined, getMessageFallback: ({ key }) => key });
    })();
    cache.set(locale, p);
  }
  return p;
}

export async function render(t: Text | null | undefined, locale: Locale): Promise<string> {
  if (t == null) return "";
  if (typeof t === "string") return t;
  const tr = await translator(locale);
  return tr(t.key as never, t.params as never);
}

/** Resolve a stored device language / Accept-Language header to a locale we ship. */
export function deviceLocale(v: string | null | undefined): Locale {
  if (isLocale(v)) return v;
  return localeFromAcceptLanguage(v) ?? DEFAULT_LOCALE;
}

/** Text as persisted in `home_notifications`: literals stay literals, refs are JSON. */
export const packText = (t: Text): string => (typeof t === "string" ? t : `\u0000${JSON.stringify(t)}`);
export const unpackText = (s: string | null): Text | null => {
  if (s == null) return null;
  if (!s.startsWith("\u0000")) return s;
  try { return JSON.parse(s.slice(1)) as Msg; } catch { return s; }
};
