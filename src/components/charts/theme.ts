"use client";

import * as React from "react";

export type ChartTone = "primary" | "accent" | "success" | "warning" | "danger" | "info";

export interface ChartTheme {
  /** Ordered palette used when a series has no explicit tone. */
  series: string[];
  tone: Record<ChartTone, string>;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  fg: string;
  bgMuted: string;
}

const VARS = {
  primary: "--color-primary",
  accent: "--color-accent",
  success: "--color-success",
  warning: "--color-warning",
  danger: "--color-danger",
  info: "--color-info",
  fgMuted: "--color-fg-muted",
  border: "--color-border",
  surface: "--color-surface",
  fg: "--color-fg",
  bgMuted: "--color-bg-muted",
} as const;

function fallback(): ChartTheme {
  const v = (name: string) => `var(${name})`;
  return {
    series: [v(VARS.primary), v(VARS.accent), v(VARS.success), v(VARS.warning), v(VARS.danger), v(VARS.info)],
    tone: {
      primary: v(VARS.primary),
      accent: v(VARS.accent),
      success: v(VARS.success),
      warning: v(VARS.warning),
      danger: v(VARS.danger),
      info: v(VARS.info),
    },
    grid: v(VARS.border),
    axis: v(VARS.fgMuted),
    tooltipBg: v(VARS.surface),
    tooltipBorder: v(VARS.border),
    fg: v(VARS.fg),
    bgMuted: v(VARS.bgMuted),
  };
}

function read(): ChartTheme {
  if (typeof document === "undefined") return fallback();
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string) => cs.getPropertyValue(name).trim() || `var(${name})`;
  const tone: Record<ChartTone, string> = {
    primary: get(VARS.primary),
    accent: get(VARS.accent),
    success: get(VARS.success),
    warning: get(VARS.warning),
    danger: get(VARS.danger),
    info: get(VARS.info),
  };
  return {
    series: [tone.primary, tone.accent, tone.success, tone.warning, tone.danger, tone.info],
    tone,
    grid: get(VARS.border),
    axis: get(VARS.fgMuted),
    tooltipBg: get(VARS.surface),
    tooltipBorder: get(VARS.border),
    fg: get(VARS.fg),
    bgMuted: get(VARS.bgMuted),
  };
}

/** Resolves the `@theme` colour tokens at mount and again whenever `<html>` attributes change (theme / accent switch). */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = React.useState<ChartTheme>(fallback);
  React.useEffect(() => {
    setTheme(read());
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function toneColor(theme: ChartTheme, tone: ChartTone | undefined, index: number): string {
  if (tone) return theme.tone[tone];
  return theme.series[index % theme.series.length] ?? theme.tone.primary;
}
