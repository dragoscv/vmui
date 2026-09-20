"use client";

import { cn } from "@/lib/utils";
import { Database, KeyRound, Settings2, ShieldCheck, Users, Workflow, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { SETTINGS_HUB_SECTIONS, type SettingsHubSection } from "./sections";

const ICON: Record<SettingsHubSection, LucideIcon> = {
  general: Settings2,
  security: ShieldCheck,
  users: Users,
  access: KeyRound,
  automation: Workflow,
  data: Database,
};

export function SettingsNav({ value, onChange }: { value: SettingsHubSection; onChange: (s: SettingsHubSection) => void }) {
  const t = useTranslations("settings.nav");
  return (
    <nav
      aria-label={t("label")}
      className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0 lg:sticky lg:top-20 lg:overflow-visible"
    >
      <ul className="flex w-max snap-x snap-mandatory gap-1 lg:w-auto lg:flex-col">
        {SETTINGS_HUB_SECTIONS.map((id) => {
          const Icon = ICON[id];
          const active = id === value;
          return (
            <li key={id} className="snap-start">
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-[var(--radius-md)] px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-muted hover:bg-bg-muted hover:text-fg",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate">{t(`${id}.title`)}</span>
                  <span className="hidden truncate text-xs font-normal text-fg-muted lg:block">{t(`${id}.hint`)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
