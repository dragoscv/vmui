"use client";

/**
 * Lightweight haptic feedback wrapper around navigator.vibrate. No-op on
 * iOS Safari (which silently ignores vibrate but doesn't throw) and on
 * desktops that don't support it. Pick a pattern by intent, not duration.
 */
export type HapticIntent =
  | "tap"
  | "select"
  | "confirm"
  | "warn"
  | "error"
  | "success"
  | "longpress";

const PATTERNS: Record<HapticIntent, number | number[]> = {
  tap: 8,
  select: 12,
  confirm: [10, 30, 20],
  success: [10, 40, 10],
  warn: [20, 40, 20],
  error: [30, 50, 30, 50, 60],
  longpress: 25,
};

let enabledCached: boolean | null = null;

function readEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (enabledCached !== null) return enabledCached;
  const stored = localStorage.getItem("vmui:haptics");
  // Default ON, opt-out via setting.
  enabledCached = stored === null ? true : stored === "1";
  return enabledCached;
}

export function setHapticsEnabled(on: boolean) {
  enabledCached = on;
  if (typeof window !== "undefined") {
    localStorage.setItem("vmui:haptics", on ? "1" : "0");
  }
}

export function haptic(intent: HapticIntent = "tap") {
  if (!readEnabled()) return;
  if (typeof navigator === "undefined") return;
  const vib = (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate;
  if (typeof vib !== "function") return;
  try {
    const p = PATTERNS[intent];
    vib.call(navigator, Array.isArray(p) ? p : [p]);
  } catch {
    /* ignore */
  }
}
