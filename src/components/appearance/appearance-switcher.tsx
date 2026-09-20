"use client";

import { useAppearance } from "@/components/appearance/appearance-provider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ACCENTS, ACCENT_HUE, DENSITIES, SURFACES, THEMES, VIBES, accentHueOf, type Accent, type Vibe } from "@/lib/appearance/model";
import { cn } from "@/lib/utils";
import { Check, Contrast, Laptop, Layers, Moon, Palette, Rows3, Square, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

const THEME_ICON = { light: Sun, dark: Moon, system: Laptop } as const;
const SURFACE_ICON = { glass: Layers, flat: Square, contrast: Contrast } as const;

function Segmented<T extends string>({ value, options, onChange, label, render }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string; render: (v: T) => React.ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] p-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cn(
            "flex min-w-0 items-center justify-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-2 py-1.5 text-xs font-medium transition-colors",
            o === value ? "bg-[var(--color-surface)] text-[var(--color-fg)] shadow-[var(--shadow-sm)]" : "text-muted hover:text-[var(--color-fg)]",
          )}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

export function AppearanceSwitcher() {
  const t = useTranslations("appearance");
  const { appearance: a, update, applyVibe } = useAppearance();
  const hue = accentHueOf(a);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("open")}>
              <Palette className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("open")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] space-y-4 p-4">
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{t("theme.label")}</h3>
          <Segmented
            value={a.theme}
            options={THEMES}
            onChange={(theme) => update({ theme })}
            label={t("theme.label")}
            render={(v) => {
              const I = THEME_ICON[v];
              return (
                <>
                  <I className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{t(`theme.${v}`)}</span>
                </>
              );
            }}
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{t("accent.label")}</h3>
            <span className="text-xs tabular-nums text-muted">{Math.round(hue)}°</span>
          </div>
          <div role="radiogroup" aria-label={t("accent.label")} className="flex flex-wrap gap-2">
            {ACCENTS.filter((x): x is Exclude<Accent, "custom"> => x !== "custom").map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={a.accent === x}
                aria-label={t(`accent.${x}`)}
                title={t(`accent.${x}`)}
                onClick={() => update({ accent: x })}
                className={cn(
                  "grid size-7 place-items-center rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]",
                  a.accent === x ? "border-[var(--color-fg)]" : "border-transparent",
                )}
                style={{ background: `oklch(0.66 0.18 ${ACCENT_HUE[x]})` }}
              >
                {a.accent === x && <Check className="size-3.5 text-white drop-shadow" aria-hidden />}
              </button>
            ))}
          </div>
          <label className="block space-y-1.5">
            <span className="block text-xs text-muted">{t("accent.custom")}</span>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={hue}
              onChange={(e) => update({ accent: "custom", accentHue: Number(e.target.value) })}
              aria-label={t("accent.custom")}
              className="vmui-range hue-range w-full"
            />
          </label>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{t("surface.label")}</h3>
          <Segmented
            value={a.surface}
            options={SURFACES}
            onChange={(surface) => update({ surface })}
            label={t("surface.label")}
            render={(v) => {
              const I = SURFACE_ICON[v];
              return (
                <>
                  <I className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{t(`surface.${v}`)}</span>
                </>
              );
            }}
          />
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{t("density.label")}</h3>
            <Segmented value={a.density} options={DENSITIES} onChange={(density) => update({ density })} label={t("density.label")} render={(v) => <><Rows3 className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{t(`density.${v}`)}</span></>} />
          </div>
          <label className="flex items-start justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2">
            <span className="min-w-0">
              <span className="block text-xs font-medium">{t("motion.label")}</span>
              <span className="block text-xs leading-snug text-muted">{t("motion.hint")}</span>
            </span>
            <Switch checked={a.reducedMotion === true} onCheckedChange={(v) => update({ reducedMotion: v ? true : null })} aria-label={t("motion.label")} />
          </label>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{t("vibe.label")}</h3>
          <div role="radiogroup" aria-label={t("vibe.label")} className="grid grid-cols-2 gap-1.5">
            {VIBES.map((v: Vibe) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={a.vibe === v}
                onClick={() => applyVibe(v)}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border px-2.5 py-2 text-left text-xs transition-colors",
                  a.vibe === v ? "border-[var(--color-primary)] bg-[color-mix(in_oklch,var(--color-primary)_12%,transparent)]" : "border-[var(--color-border)] hover:bg-[var(--color-bg-muted)]",
                )}
              >
                <span className="size-3 shrink-0 rounded-full" style={{ background: `conic-gradient(oklch(0.7 0.18 ${vibeHue(v)}), oklch(0.7 0.16 ${vibeHue(v) - 60}), oklch(0.7 0.18 ${vibeHue(v)}))` }} aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{t(`vibe.${v}.name`)}</span>
                  <span className="block truncate text-muted">{t(`vibe.${v}.hint`)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}

function vibeHue(v: Vibe): number {
  switch (v) {
    case "cyberpunk":
    case "synthwave":
      return 340;
    case "cockpit":
    case "strategy":
      return 75;
    case "terminal":
      return 145;
    case "aurora":
      return 185;
    case "minimal":
      return 270;
    default:
      return 265;
  }
}
