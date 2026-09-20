"use client";

import { useAppearance } from "@/components/appearance/appearance-provider";
import { LocaleSwitcher } from "@/components/nav/locale-switcher";
import { Button } from "@/components/ui/button";
import { Cloud, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import * as React from "react";

export function AuthCard({ title, description, children, footer }: { title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const t = useTranslations("auth");
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }} className="w-full max-w-sm">
      <div className="surface space-y-6 p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-gradient-to-br from-primary to-accent text-primary-fg shadow-[var(--shadow-glow)]">
            <Cloud className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="text-base font-semibold">{t("brand.name")}</div>
            <div className="truncate text-xs text-fg-muted">{t("brand.tagline")}</div>
          </div>
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-fg-muted">{description}</p>}
        </div>
        {children}
        {footer && <div className="text-center text-xs text-fg-muted">{footer}</div>}
      </div>
      <div className="mt-3 flex items-center justify-center gap-1">
        <ThemeToggle />
        <LocaleSwitcher />
      </div>
    </motion.div>
  );
}

function ThemeToggle() {
  const t = useTranslations("auth.theme");
  const { update } = useAppearance();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? t("toLight") : t("toDark");
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} title={label} onClick={() => update({ theme: dark ? "light" : "dark" })}>
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </Button>
  );
}

export function AuthDivider() {
  const t = useTranslations("auth");
  return (
    <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-fg-muted" role="separator">
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span>{t("or")}</span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}
