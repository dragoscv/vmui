"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { CommandPalette } from "./command-palette";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { syncAllAccounts } from "@/server/actions/instances";

/**
 * Mounts the command palette + shortcuts overlay and wires the global
 * keyboard listeners. Designed to be dropped into the root layout once.
 *
 * Hotkeys:
 *   ⌘K / Ctrl+K  → command palette
 *   ?            → shortcuts dialog
 *   N            → /instances/new
 *   R            → sync all accounts
 *   T            → toggle theme
 *   G then I/A/L/S → go to instances/accounts/log/settings
 */
export function GlobalOverlays() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [, start] = useTransition();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const goPrefix = useRef<{ at: number } | null>(null);

  const isTypingTarget = (el: EventTarget | null) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  };

  const syncNow = useCallback(() => {
    start(async () => {
      try {
        const r = await syncAllAccounts();
        toast.success(`Synced ${r.accounts} account(s) — ${r.instances} instance(s)`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Sync failed");
      }
    });
  }, [router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K / Ctrl+K: always open palette, even when typing.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((p) => !p);
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // 'go to' two-key sequence: G then I/A/L/S
      if (goPrefix.current && Date.now() - goPrefix.current.at < 1500) {
        goPrefix.current = null;
        switch (e.key.toLowerCase()) {
          case "i":
            e.preventDefault();
            router.push("/");
            return;
          case "a":
            e.preventDefault();
            router.push("/accounts");
            return;
          case "l":
            e.preventDefault();
            router.push("/activity");
            return;
          case "s":
            e.preventDefault();
            router.push("/settings");
            return;
        }
      }

      switch (e.key) {
        case "?":
          e.preventDefault();
          setShortcutsOpen(true);
          return;
        case "g":
        case "G":
          goPrefix.current = { at: Date.now() };
          return;
        case "n":
        case "N":
          e.preventDefault();
          router.push("/instances/new");
          return;
        case "r":
        case "R":
          e.preventDefault();
          syncNow();
          return;
        case "t":
        case "T":
          e.preventDefault();
          setTheme(resolvedTheme === "dark" ? "light" : "dark");
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolvedTheme, router, setTheme, syncNow]);

  return (
    <>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
