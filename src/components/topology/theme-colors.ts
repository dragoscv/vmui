"use client";

import { useEffect, useState } from "react";

export type Rgb = [number, number, number];

const THEME_ATTRS = ["class", "data-theme", "style"];

/** Raw `--color-<name>` values from `:root`, re-read whenever the theme attributes change. */
export function useThemeTokens<const K extends readonly string[]>(names: K): Record<K[number], string> {
  const key = names.join("|");
  const [tokens, setTokens] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const css = getComputedStyle(document.documentElement);
      const next: Record<string, string> = {};
      for (const n of key.split("|")) next[n] = css.getPropertyValue(`--color-${n}`).trim();
      setTokens(next);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRS });
    return () => observer.disconnect();
  }, [key]);
  return tokens as Record<K[number], string>;
}

let scratch: CanvasRenderingContext2D | null | undefined;

// three.js and SVG attributes cannot parse oklch(); paint the token onto a 1px canvas and read it back as rgb.
export function resolveRgb(cssColor: string): Rgb {
  if (scratch === undefined) scratch = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!scratch || !cssColor) return [0, 0, 0];
  scratch.clearRect(0, 0, 1, 1);
  scratch.fillStyle = cssColor;
  scratch.fillRect(0, 0, 1, 1);
  const d = scratch.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

export function rgbToCss([r, g, b]: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

export function useResolvedTokens<const K extends readonly string[]>(names: K): Record<K[number], Rgb> | null {
  const raw = useThemeTokens(names);
  const [resolved, setResolved] = useState<Record<string, Rgb> | null>(null);
  useEffect(() => {
    if (Object.keys(raw).length === 0) return;
    const next: Record<string, Rgb> = {};
    for (const [k, v] of Object.entries(raw as Record<string, string>)) next[k] = resolveRgb(v);
    setResolved(next);
  }, [raw]);
  return resolved as Record<K[number], Rgb> | null;
}
