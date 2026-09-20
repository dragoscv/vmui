"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const STORAGE_KEY = "vmui:install:dismissed";
const SHOWN_KEY = "vmui:install:shown";

export function InstallPrompt() {
  const t = useTranslations("misc.install");
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "1") return;
    if (localStorage.getItem(SHOWN_KEY) === "1") return;

    const handler = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
      const t = setTimeout(() => {
        setVisible(true);
        localStorage.setItem(SHOWN_KEY, "1");
      }, 30_000);
      return () => clearTimeout(t);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible || !event) return null;

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, "1");
    haptic("tap");
  };

  const install = async () => {
    haptic("confirm");
    try {
      await event.prompt();
      await event.userChoice;
    } finally {
      setVisible(false);
      setEvent(null);
      localStorage.setItem(STORAGE_KEY, "1");
    }
  };

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      className="fixed inset-x-3 z-50 rounded-[var(--radius-xl)] border border-border bg-surface p-3 shadow-lg backdrop-blur-md md:inset-x-auto md:right-4 md:max-w-sm"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.5rem)" }}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-[var(--radius-lg)] bg-[color-mix(in_oklch,var(--color-primary)_15%,transparent)] p-2 text-primary">
          <Download className="h-4 w-4" aria-hidden />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">{t("title")}</p>
          <p className="text-xs text-fg-muted">{t("description")}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" size="sm" onClick={install}>
              {t("install")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={dismiss}>
              {t("notNow")}
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("dismiss")}
          className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-fg-muted hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Button variant for use on the Settings page; triggers the same flow on demand if a prompt event was captured. */
export function InstallButton() {
  const t = useTranslations("misc.install");
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = async () => {
    if (!event) return;
    haptic("confirm");
    try {
      await event.prompt();
      await event.userChoice;
    } finally {
      setEvent(null);
    }
  };

  return (
    <Button type="button" variant="secondary" size="sm" onClick={install} disabled={!event}>
      <Download className="h-3 w-3" aria-hidden /> {event ? t("title") : t("unavailable")}
    </Button>
  );
}
