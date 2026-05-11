"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { haptic } from "@/lib/haptics";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const STORAGE_KEY = "vmui:install:dismissed";
const SHOWN_KEY = "vmui:install:shown";

export function InstallPrompt() {
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
      className="fixed inset-x-3 z-50 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg backdrop-blur-md md:inset-x-auto md:right-4 md:max-w-sm"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.5rem)" }}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-[var(--color-primary)]/15 p-2 text-[var(--color-primary)]">
          <Download className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">Install vmui</p>
          <p className="text-xs text-muted">
            Add to home screen for full-screen access, offline cache, and push notifications.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={install}
              className="rounded-md bg-[var(--color-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--color-primary-fg)]"
            >
              Install
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-muted hover:bg-[var(--color-surface-muted)]"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded p-1 text-muted hover:bg-[var(--color-surface-muted)]"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/** Button variant for use on the Settings page; triggers the same flow on demand if a prompt event was captured. */
export function InstallButton() {
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
    <button
      type="button"
      onClick={install}
      disabled={!event}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface)] disabled:opacity-50"
    >
      <Download className="h-3 w-3" /> {event ? "Install vmui" : "Already installed or unavailable"}
    </button>
  );
}
