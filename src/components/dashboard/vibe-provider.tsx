"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const VIBES = [
  "default",
  "cyberpunk",
  "cockpit",
  "strategy",
  "terminal",
  "minimal",
  "aurora",
  "synthwave",
] as const;

export type Vibe = (typeof VIBES)[number];

export const VIBE_LABEL: Record<Vibe, string> = {
  default: "Default",
  cyberpunk: "Cyberpunk neon",
  cockpit: "Mission cockpit",
  strategy: "Strategy map",
  terminal: "Phosphor terminal",
  minimal: "Minimal cinematic",
  aurora: "Aurora glass",
  synthwave: "Synthwave grid",
};

export const VIBE_DESCRIPTION: Record<Vibe, string> = {
  default: "vmui's signature gradient and depth.",
  cyberpunk: "Magenta-cyan neon, wireframe glyph, binary rain.",
  cockpit: "Amber radar sweep, gauges, mission HUD.",
  strategy: "Globe with arcs between regions, command-room calm.",
  terminal: "Phosphor green CRT, scanlines, type-in stats.",
  minimal: "Ivory typography, hairline rules, generous whitespace.",
  aurora: "Deep night with shifting iridescent ribbons.",
  synthwave: "Sun on a chrome horizon over a magenta grid.",
};

const STORAGE_KEY = "vmui:vibe";
const COOKIE_NAME = "vmui_vibe";

interface VibeCtx {
  vibe: Vibe;
  setVibe: (v: Vibe) => void;
  ready: boolean;
}

const Ctx = createContext<VibeCtx | null>(null);

function isVibe(value: unknown): value is Vibe {
  return typeof value === "string" && (VIBES as readonly string[]).includes(value);
}

function readInitial(): Vibe {
  if (typeof document === "undefined") return "default";
  const attr = document.documentElement.getAttribute("data-vibe");
  if (isVibe(attr)) return attr;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isVibe(stored)) return stored;
  } catch {
    // ignore
  }
  return "default";
}

export function VibeProvider({ children, initial }: { children: ReactNode; initial?: Vibe }) {
  const [vibe, setVibeState] = useState<Vibe>(initial && isVibe(initial) ? initial : "default");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setVibeState(readInitial());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.setAttribute("data-vibe", vibe);
    try {
      window.localStorage.setItem(STORAGE_KEY, vibe);
    } catch {
      // ignore
    }
    document.cookie = `${COOKIE_NAME}=${vibe}; path=/; max-age=31536000; samesite=lax`;
  }, [vibe, ready]);

  const setVibe = useCallback((v: Vibe) => {
    if (isVibe(v)) setVibeState(v);
  }, []);

  const value = useMemo<VibeCtx>(() => ({ vibe, setVibe, ready }), [vibe, setVibe, ready]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVibe(): VibeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return { vibe: "default", setVibe: () => undefined, ready: false };
  }
  return ctx;
}
