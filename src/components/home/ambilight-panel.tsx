"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { AMBILIGHT_LABEL, ambilightStatus } from "@/lib/home/ambilight-status";
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
import { Bell, Clapperboard, Eraser, Lamp, MonitorPlay, Music2, PaintRoller, Zap } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";
import { useEntity, useHomeStates } from "./use-home-states";

const MODE_ICON = { movie: Clapperboard, music: Music2, off: Lamp } as const;

export function AmbilightPanel({ wall }: { wall: WallSetting }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<string | null>(null);
  const { live } = useHomeStates();
  const hyper = useEntity("light.hyperhdr");
  const lastNotif = useEntity("sensor.dragos_s_s25_ultra_last_notification");

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) toast.error(r.error ?? "Failed");
    else if (okMsg) toast.success(okMsg);
    return r.ok;
  };

  return (
    <section aria-labelledby="ambilight-h" className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="ambilight-h" className="text-lg font-semibold tracking-tight">
            Ambilight
          </h2>
          <p className="text-sm text-muted">The OLED drives every light. Pick what the room does.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={live === "live" ? "success" : live === "connecting" ? "muted" : "warning"} dot>
            {live === "live" ? "live" : live === "connecting" ? "connecting" : "offline"}
          </Badge>
          <Badge variant={ambilightStatus(hyper) === "unreachable" ? "danger" : ambilightStatus(hyper) === "movie" ? "success" : "info"}>
            HyperHDR {AMBILIGHT_LABEL[ambilightStatus(hyper)]}
          </Badge>
        </div>
      </header>

      {/* Modes */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {AMBILIGHT_MODES.map((m) => {
          const Icon = MODE_ICON[m.id];
          const active = mode === m.id;
          return (
            <motion.button
              key={m.id}
              type="button"
              whileTap={{ scale: 0.97 }}
              disabled={busy !== null}
              onClick={() => act(m.id, () => setAmbilightModeAction(m.id), `${m.name} mode`).then((ok) => ok && setMode(m.id))}
              aria-pressed={active}
              className={cn(
                "group relative flex min-h-[104px] flex-col items-start justify-between overflow-hidden rounded-[var(--radius-lg)] border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:min-h-[120px] sm:p-4",
                active
                  ? "border-[var(--color-primary)] bg-[color-mix(in_oklch,var(--color-primary)_14%,var(--color-surface))]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[color-mix(in_oklch,var(--color-primary)_55%,var(--color-border))]",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl transition-opacity",
                  active ? "opacity-70" : "opacity-0 group-hover:opacity-40",
                )}
                style={{ background: m.id === "movie" ? "oklch(0.7 0.18 40)" : m.id === "music" ? "oklch(0.7 0.2 300)" : "oklch(0.85 0.1 80)" }}
              />
              <Icon className={cn("h-5 w-5", active ? "text-[var(--color-primary)]" : "text-muted")} />
              <span>
                <span className="block text-sm font-semibold">{m.name}</span>
                <span className="block text-[11px] leading-snug text-muted">{m.description}</span>
              </span>
              {busy === m.id && <span className="pulse-dot absolute right-3 top-3" aria-hidden />}
            </motion.button>
          );
        })}
      </div>

      {/* Grabber + clear */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
        <div className="flex items-center gap-3">
          <MonitorPlay className="h-4 w-4 text-muted" />
          <div>
            <p className="text-sm font-medium">Screen capture</p>
            <p className="text-xs text-muted">DX11 · 60 fps · HDR tone-mapped</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            defaultChecked
            onCheckedChange={(v) => act("grabber", () => setGrabberAction(v))}
            aria-label="Screen capture on all instances"
          />
          <Button variant="ghost" size="sm" onClick={() => act("clear", () => clearHyperPriorityAction(40), "Effects cleared")}>
            <Eraser className="mr-1.5 h-3.5 w-3.5" /> Clear effects
          </Button>
        </div>
      </div>

      <WallCard wall={wall} busy={busy === "wall"} onApply={(w) => act("wall", () => setWallCompensationAction(w), "Wall compensation applied")} />

      {/* Effects */}
      <div className="grid gap-4 md:grid-cols-2">
        <EffectGroup title="Music" icon={Music2} effects={MUSIC_EFFECTS} busy={busy} onPick={(e) => act(e, () => runHyperEffectAction({ effect: e }))} strip="Music: " />
        <EffectGroup title="Ambient" icon={Zap} effects={AMBIENT_EFFECTS} busy={busy} onPick={(e) => act(e, () => runHyperEffectAction({ effect: e }))} />
      </div>

      {/* Notify flash */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted" />
          <p className="text-sm font-medium">Notification flash</p>
          <span className="text-xs text-muted">— the phone triggers these automatically</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {NOTIFY_PALETTE.map((n) => (
            <button
              key={n.app}
              type="button"
              onClick={() => act(n.app, () => notifyFlashAction({ color: n.color, durationMs: 1500 }))}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs transition-colors hover:border-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <span className="h-3 w-3 rounded-full" style={{ background: `rgb(${n.color.join(" ")})` }} aria-hidden />
              {n.label}
            </button>
          ))}
        </div>
        {lastNotif && (
          <p className="text-xs text-muted">
            Last phone notification: <span className="text-[var(--color-fg)]">{String(lastNotif.attributes["android.title"] ?? lastNotif.attributes.package ?? "")}</span>
          </p>
        )}
      </div>

      {/* Instances */}
      <div className="grid gap-2 sm:grid-cols-3">
        {HYPERHDR_INSTANCES.map((i) => (
          <div key={i.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted">inst {i.id}</span>
              <Badge variant="muted">{i.fps} fps</Badge>
            </div>
            <p className="mt-1 text-sm font-medium">{i.name}</p>
            <p className="text-xs text-muted">{i.target}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The monitor strip lights a painted wall; the eye sees strip × wall
 * reflectance. Pick the wall colour, pull the slider until white on screen
 * looks white on the wall.
 */
function WallCard({ wall, busy, onApply }: { wall: WallSetting; busy: boolean; onApply: (w: WallSetting) => Promise<boolean> }) {
  const [hex, setHex] = React.useState(wall.wallHex);
  const [strength, setStrength] = React.useState(Math.round(wall.strength * 100));
  const dirty = hex !== wall.wallHex || strength !== Math.round(wall.strength * 100);
  const commit = (s = strength, h = hex) => onApply({ wallHex: h, strength: s / 100 });
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PaintRoller className="h-4 w-4 text-muted" />
          <div>
            <p className="text-sm font-medium">Wall compensation</p>
            <p className="text-xs text-muted">Corrects the monitor strip for the colour of the wall behind it</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          Wall
          <input
            type="color"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            onBlur={() => dirty && commit()}
            aria-label="Wall colour"
            className="h-8 w-10 cursor-pointer rounded-md border border-[var(--color-border)] bg-transparent p-0.5"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Slider
          min={0}
          max={100}
          step={5}
          value={strength}
          onChange={setStrength}
          onCommit={(v) => commit(v)}
          aria-label="Compensation strength"
          track={`linear-gradient(90deg, ${hex} 0%, white 100%)`}
        />
        <span className="w-12 text-right text-sm tabular-nums">{strength}%</span>
        {busy && <span className="pulse-dot" aria-hidden />}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-muted">Preview of “white” on the wall:</span>
        <span className="h-4 w-16 rounded-sm border border-[var(--color-border)]" style={{ background: previewOnWall(hex, strength / 100) }} aria-hidden />
      </div>
    </div>
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

function EffectGroup({
  title,
  icon: Icon,
  effects,
  busy,
  onPick,
  strip,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  effects: readonly string[];
  busy: string | null;
  onPick: (effect: string) => void;
  strip?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted" />
        <p className="text-sm font-medium">{title}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {effects.map((e) => (
          <button
            key={e}
            type="button"
            disabled={busy !== null}
            onClick={() => onPick(e)}
            className={cn(
              "rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs transition-colors hover:border-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50",
              busy === e && "border-[var(--color-primary)]",
            )}
          >
            {strip ? e.replace(strip, "") : e}
          </button>
        ))}
      </div>
    </div>
  );
}
