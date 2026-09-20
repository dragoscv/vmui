"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Panel, Subsection } from "@/components/ui/settings-panel";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ambilightStatus } from "@/lib/home/ambilight-status";
import { AMBIENT_EFFECTS, AMBILIGHT_MODES, HYPERHDR_INSTANCES, MUSIC_EFFECTS, NOTIFY_PALETTE } from "@/lib/home/catalog";
import { cn } from "@/lib/utils";
import {
    clearHyperPriorityAction,
    notifyFlashAction,
    runHyperEffectAction,
    setAmbilightModeAction,
    setGrabberAction,
    setWallCompensationAction,
} from "@/server/actions/home";
import type { WallSetting } from "@/server/queries/home";
import { Bell, Clapperboard, Eraser, Lamp, MonitorPlay, Music2, Zap } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { useEntity, useHomeStates } from "./use-home-states";

const MODE_ICON = { movie: Clapperboard, music: Music2, off: Lamp } as const;

type EffectKey =
  | "musicStereo"
  | "musicStereoFast"
  | "musicQuatro"
  | "musicPulseWaves"
  | "musicFullscreenPulse"
  | "musicFullscreenPulseWhite"
  | "warmBlobs"
  | "coldBlobs"
  | "colorBlobs"
  | "seaWaves"
  | "rainbowSwirl"
  | "plasma"
  | "candle"
  | "breath";

const EFFECT_KEY: Record<(typeof MUSIC_EFFECTS)[number] | (typeof AMBIENT_EFFECTS)[number], EffectKey> = {
  "Music: stereo for LED strip (MULTI COLOR)": "musicStereo",
  "Music: stereo for LED strip (MULTI COLOR FAST)": "musicStereoFast",
  "Music: quatro for LED strip (MULTI COLOR)": "musicQuatro",
  "Music: pulse waves for LED strip (MULTI COLOR)": "musicPulseWaves",
  "Music: fullscreen pulse (MULTI COLOR)": "musicFullscreenPulse",
  "Music: fullscreen pulse (WHITE)": "musicFullscreenPulseWhite",
  "Warm mood blobs": "warmBlobs",
  "Cold mood blobs": "coldBlobs",
  "Full color mood blobs": "colorBlobs",
  "Sea waves": "seaWaves",
  "Rainbow swirl": "rainbowSwirl",
  Plasma: "plasma",
  Candle: "candle",
  Breath: "breath",
};

const NOTIFY_APP_KEY: Record<string, "whatsapp" | "phone" | "messages" | "gmail"> = {
  "com.whatsapp": "whatsapp",
  "com.samsung.android.dialer": "phone",
  "com.samsung.android.messaging": "messages",
  "com.google.android.gm": "gmail",
};

export function AmbilightPanel({ wall }: { wall: WallSetting }) {
  const t = useTranslations("ambilight");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<string | null>(null);
  const { live } = useHomeStates();
  const hyper = useEntity("light.hyperhdr");
  const lastNotif = useEntity("sensor.dragos_s_s25_ultra_last_notification");
  const status = ambilightStatus(hyper);

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) toast.error(r.error ?? t("failed"));
    else if (okMsg) toast.success(okMsg);
    return r.ok;
  };

  const effectButtons = (effects: readonly ((typeof MUSIC_EFFECTS)[number] | (typeof AMBIENT_EFFECTS)[number])[], Icon: React.ComponentType<{ className?: string }>) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {effects.map((e) => (
        <button
          key={e}
          type="button"
          disabled={busy !== null}
          title={e}
          onClick={() => act(e, () => runHyperEffectAction({ effect: e }))}
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm transition-colors hover:border-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50",
            busy === e && "border-[var(--color-primary)]",
          )}
        >
          <Icon className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 truncate">{t(`effects.${EFFECT_KEY[e]}`)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Panel
      id="ambilight"
      title={t("title")}
      description={t("description")}
      action={
        <>
          <Badge variant={live === "live" ? "success" : live === "connecting" ? "muted" : "warning"} dot>
            {t(`live.${live === "live" ? "live" : live === "connecting" ? "connecting" : "offline"}`)}
          </Badge>
          <Badge variant={status === "unreachable" ? "danger" : status === "movie" ? "success" : "info"}>{t("hyperhdr", { status: t(`status.${status}`) })}</Badge>
        </>
      }
    >
      <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {AMBILIGHT_MODES.map((m) => {
          const Icon = MODE_ICON[m.id];
          const active = mode === m.id;
          const name = t(`modes.${m.id}.name`);
          return (
            <motion.button
              key={m.id}
              type="button"
              whileTap={{ scale: 0.97 }}
              disabled={busy !== null}
              onClick={() => act(m.id, () => setAmbilightModeAction(m.id), t("modeApplied", { name })).then((ok) => ok && setMode(m.id))}
              aria-pressed={active}
              className={cn(
                "group relative flex min-w-0 items-center gap-3 overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]",
                active
                  ? "border-[var(--color-primary)] bg-[color-mix(in_oklch,var(--color-primary)_14%,var(--color-surface))]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[color-mix(in_oklch,var(--color-primary)_55%,var(--color-border))]",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -right-6 -top-6 size-20 rounded-full blur-2xl transition-opacity",
                  active ? "opacity-70" : "opacity-0 group-hover:opacity-40",
                )}
                style={{ background: m.id === "movie" ? "oklch(0.7 0.18 40)" : m.id === "music" ? "oklch(0.7 0.2 300)" : "oklch(0.85 0.1 80)" }}
              />
              <Icon className={cn("size-4 shrink-0", active ? "text-[var(--color-primary)]" : "text-muted")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{name}</span>
                <span className="block truncate text-xs text-muted">{t(`modes.${m.id}.description`)}</span>
              </span>
              {busy === m.id && <span className="pulse-dot shrink-0" aria-hidden />}
            </motion.button>
          );
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <Field
          inline
          label={
            <span className="flex items-center gap-2">
              <MonitorPlay className="size-4 shrink-0 text-muted" />
              <span className="truncate">{t("capture.title")}</span>
            </span>
          }
          hint={t("capture.hint")}
        >
          <Switch defaultChecked onCheckedChange={(v) => act("grabber", () => setGrabberAction(v))} aria-label={t("capture.switch")} />
        </Field>
        <Button variant="ghost" size="sm" className="justify-self-start sm:justify-self-auto" onClick={() => act("clear", () => clearHyperPriorityAction(40), t("effectsCleared"))}>
          <Eraser className="mr-1.5 h-3.5 w-3.5" /> {t("clearEffects")}
        </Button>
      </div>

      <WallCard wall={wall} busy={busy === "wall"} onApply={(w) => act("wall", () => setWallCompensationAction(w), t("wall.applied"))} />

      <Subsection title={t("groups.music")}>{effectButtons(MUSIC_EFFECTS, Music2)}</Subsection>
      <Subsection title={t("groups.ambient")}>{effectButtons(AMBIENT_EFFECTS, Zap)}</Subsection>

      <Subsection
        title={
          <span className="flex items-center gap-1.5">
            <Bell className="size-3.5 shrink-0" />
            {t("notify.title")}
          </span>
        }
        hint={t("notify.hint")}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {NOTIFY_PALETTE.map((n) => (
            <button
              key={n.app}
              type="button"
              onClick={() => act(n.app, () => notifyFlashAction({ color: n.color, durationMs: 1500 }))}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm transition-colors hover:border-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <span className="size-3 shrink-0 rounded-full" style={{ background: `rgb(${n.color.join(" ")})` }} aria-hidden />
              <span className="min-w-0 truncate">{NOTIFY_APP_KEY[n.app] ? t(`notify.apps.${NOTIFY_APP_KEY[n.app]!}`) : n.label}</span>
            </button>
          ))}
        </div>
        {lastNotif && (
          <p className="text-xs text-muted">
            {t("notify.last")}: <span className="text-[var(--color-fg)]">{String(lastNotif.attributes["android.title"] ?? lastNotif.attributes.package ?? "")}</span>
          </p>
        )}
      </Subsection>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {HYPERHDR_INSTANCES.map((i) => (
          <div key={i.id} className="min-w-0 rounded-lg border border-[var(--color-border)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted">{t("instances.label", { n: i.id })}</span>
              <Badge variant="muted">{t("instances.fps", { n: i.fps })}</Badge>
            </div>
            <p className="mt-1 truncate text-sm font-medium">{t(`instances.${i.id}.name`)}</p>
            <p className="truncate text-xs text-muted">{t(`instances.${i.id}.target`)}</p>
          </div>
        ))}
      </div>
      </div>
    </Panel>
  );
}

/**
 * The monitor strip lights a painted wall; the eye sees strip × wall
 * reflectance. Pick the wall colour, pull the slider until white on screen
 * looks white on the wall.
 */
function WallCard({ wall, busy, onApply }: { wall: WallSetting; busy: boolean; onApply: (w: WallSetting) => Promise<boolean> }) {
  const t = useTranslations("ambilight.wall");
  const [hex, setHex] = React.useState(wall.wallHex);
  const [strength, setStrength] = React.useState(Math.round(wall.strength * 100));
  const dirty = hex !== wall.wallHex || strength !== Math.round(wall.strength * 100);
  const commit = (s = strength, h = hex) => onApply({ wallHex: h, strength: s / 100 });
  return (
    <Subsection title={t("title")} hint={t("description")}>
      <Field inline label={t("colour")}>
        <input
          type="color"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() => dirty && commit()}
          aria-label={t("colourLabel")}
          className="h-8 w-10 cursor-pointer rounded-md border border-[var(--color-border)] bg-transparent p-0.5"
        />
      </Field>
      <div className="space-y-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs text-muted">
          <span className="min-w-0 truncate">{t("strength")}</span>
          <span className="flex items-center gap-2 tabular-nums">
            {busy && <span className="pulse-dot" aria-hidden />}
            {strength}%
          </span>
        </div>
        <Slider
          min={0}
          max={100}
          step={5}
          value={strength}
          onChange={setStrength}
          onCommit={(v) => commit(v)}
          aria-label={t("strength")}
          track={`linear-gradient(90deg, ${hex} 0%, white 100%)`}
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <span className="min-w-0 truncate text-xs text-muted">{t("preview")}</span>
        <span className="h-4 w-16 rounded-sm border border-[var(--color-border)]" style={{ background: previewOnWall(hex, strength / 100) }} aria-hidden />
      </div>
    </Subsection>
  );
}

// Same maths as New-WallCompensation (ambilight/hyperhdr-layout.ps1): the
// strip's white after per-channel gains, seen through the wall's reflectance.
function previewOnWall(hex: string, strength: number): string {
  const refl = [1, 3, 5].map((i) => Math.max(0.2, parseInt(hex.slice(i, i + 2), 16) / 255));
  const inv = refl.map((r) => 1 / r);
  const m = Math.max(...inv);
  const out = refl.map((r, i) => {
    const k = 1 + strength * ((inv[i] ?? 1) / m - 1);
    return Math.round(255 * Math.min(1, k * r * 1.6));
  });
  return `rgb(${out.join(" ")})`;
}
