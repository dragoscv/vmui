"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LOCALES, type Locale } from "@/i18n/config";
import { setLocale } from "@/server/actions/locale";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** RO ⇄ EN. One click flips to the other language; the choice lives in a cookie. */
export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations("nav");
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length] ?? "en";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={pending}
          aria-label={t("switchLanguage", { lang: next.toUpperCase() })}
          onClick={() => start(async () => { await setLocale(next); router.refresh(); })}
          className="text-xs font-semibold tabular-nums"
        >
          {locale.toUpperCase()}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("switchLanguage", { lang: next.toUpperCase() })}</TooltipContent>
    </Tooltip>
  );
}
