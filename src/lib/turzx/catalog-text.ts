import "server-only";

import type { Locale } from "@/i18n/config";
import { DISPLAY_VIEW_IDS, DISPLAY_VIEW_META } from "@/lib/display/settings-meta";
import { TURZX_BG_SOURCES, TURZX_SKINS, TURZX_VIEW_IDS, TURZX_VIEW_META, type OptionField } from "@/lib/turzx/catalog";
import { createTranslator } from "next-intl";

// Same text the /home cards read through useTranslations, resolved once on
// the server for consumers that have no next-intl of their own (the desktop
// app reads /api/desktop/settings and renders labels verbatim).

type Labelled = { label: string; description: string };
export type OptionFieldText = OptionField & { label: string; hint?: string; placeholder?: string; choiceLabels?: Record<string, string> };

type Tr = { (k: string): string; has(k: string): boolean };
const cache = new Map<Locale, Promise<{ turzx: Tr; nestHub: Tr }>>();

async function translators(locale: Locale): Promise<{ turzx: Tr; nestHub: Tr }> {
  let p = cache.get(locale);
  if (!p) {
    p = (async () => {
      const [turzx, nestHub] = await Promise.all([import(`../../../messages/turzx/${locale}.json`), import(`../../../messages/nestHub/${locale}.json`)]);
      const mk = (ns: string, messages: unknown): Tr =>
        createTranslator({ locale, messages: { [ns]: messages } as never, namespace: ns as never, onError: () => undefined, getMessageFallback: ({ key }) => key }) as unknown as Tr;
      return { turzx: mk("turzx", turzx.default), nestHub: mk("nestHub", nestHub.default) };
    })();
    cache.set(locale, p);
  }
  return p;
}

export async function catalogText(locale: Locale) {
  const { turzx: t, nestHub: n } = await translators(locale);
  const pair = (tr: (k: string) => string, prefix: string): Labelled => ({ label: tr(`${prefix}.label`), description: tr(`${prefix}.description`) });
  const option = (view: string, f: OptionField): OptionFieldText => {
    const p = `options.${view}.${f.key}`;
    const out: OptionFieldText = { ...f, label: t(`${p}.label`) };
    if (t.has(`${p}.hint`)) out.hint = t(`${p}.hint`);
    if (t.has(`${p}.placeholder`)) out.placeholder = t(`${p}.placeholder`);
    if (f.type === "select") out.choiceLabels = Object.fromEntries(f.choices.map((c) => [c, t(`${p}.choice_${c}`)]));
    return out;
  };
  return {
    turzxViews: Object.fromEntries(TURZX_VIEW_IDS.map((id) => [id, { ...TURZX_VIEW_META[id], ...pair(t, `views.${id}`), options: TURZX_VIEW_META[id].options.map((f) => option(id, f)) }])),
    turzxSkins: TURZX_SKINS.map((id) => ({ id, ...pair(t, `skins.${id}`) })),
    displayViews: Object.fromEntries(DISPLAY_VIEW_IDS.map((id) => [id, { ...DISPLAY_VIEW_META[id], ...pair(n, `views.${id}`) }])),
    photoSources: TURZX_BG_SOURCES.map((id) => ({ id, ...pair(t, `sources.${id}`) })),
  };
}
