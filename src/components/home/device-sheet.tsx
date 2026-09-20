"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/settings-panel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { HaState } from "@/lib/home/ha-client";
import { cn } from "@/lib/utils";
import {
    mediaCommandAction,
    selectOptionAction,
    setClimateAction,
    setLightAction,
    toggleEntityAction,
} from "@/server/actions/home";
import type { PlacedDevice } from "@/server/queries/home";
import { ExternalLink, Minus, Play, Plus, Power, Volume1, Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { KIND_ICON, useKindLabel } from "./device-icon";
import { brightnessPct, hexToRgb, isOn, kelvinOf, kelvinToCss, rgbOf, rgbToHex, useEntity, useHomeStates } from "./use-home-states";

const PRESETS: Array<{ id: "cinema" | "ocean" | "forest" | "violet" | "rose" | "daylight"; rgb: [number, number, number] }> = [
  { id: "cinema", rgb: [255, 120, 40] },
  { id: "ocean", rgb: [30, 120, 255] },
  { id: "forest", rgb: [40, 200, 120] },
  { id: "violet", rgb: [140, 70, 255] },
  { id: "rose", rgb: [255, 70, 140] },
  { id: "daylight", rgb: [255, 244, 229] },
];

const HVAC_MODES = ["off", "cool", "heat", "dry", "fan_only", "auto", "heat_cool"] as const;
type HvacMode = (typeof HVAC_MODES)[number];
const isHvacMode = (m: string): m is HvacMode => (HVAC_MODES as readonly string[]).includes(m);

export function DeviceSheet({ device, haUrl, onClose }: { device: PlacedDevice | null; haUrl: string | null; onClose: () => void }) {
  const t = useTranslations("homeCards.device");
  const kindLabel = useKindLabel();
  return (
    <Sheet open={device !== null} onOpenChange={(o) => !o && onClose()}>
      {device && (
        <SheetContent title={device.name} description={t("subtitle", { kind: kindLabel(device.kind), via: device.via })}>
          <DeviceBody device={device} haUrl={haUrl} />
        </SheetContent>
      )}
    </Sheet>
  );
}

function DeviceBody({ device, haUrl }: { device: PlacedDevice; haUrl: string | null }) {
  const t = useTranslations("homeCards.device");
  const s = useEntity(device.entity);
  const Icon = KIND_ICON[device.kind];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-bg-muted)_60%,transparent)] p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--color-surface)] text-[var(--color-fg)]">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 basis-[10rem]">
          <p className="text-sm font-semibold">{friendlyState(device, s, t)}</p>
          {device.notes && <p className="text-xs text-muted">{device.notes}</p>}
        </div>
        {device.ambilight && <Badge variant="info">{t("ambilightZone", { zone: device.ambilight })}</Badge>}
      </div>

      {device.kind === "light" || device.kind === "strip" || device.kind === "projector" ? (
        device.entity ? <LightControls entity={device.entity} whiteOnly={device.whiteOnly} /> : <StaticStrip device={device} />
      ) : null}
      {device.kind === "ac" && device.entity && <ClimateControls entity={device.entity} />}
      {(device.kind === "tv" || device.kind === "display" || device.kind === "monitor") && device.entity && <MediaControls entity={device.entity} />}
      {(device.kind === "sensor" || device.kind === "presence" || device.kind === "door") && <SensorReadout device={device} />}

      {device.entities && device.entities.length > 0 && <ExtraEntities ids={device.entities} />}

      {haUrl && device.entity && (
        <a
          href={`${haUrl}/config/entities?search=${encodeURIComponent(device.entity)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--color-fg)]"
        >
          {t("openInHa")} <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

type DeviceT = ReturnType<typeof useTranslations<"homeCards.device">>;

function friendlyState(d: PlacedDevice, s: HaState | undefined, t: DeviceT) {
  if (!d.entity) return d.kind === "pc" ? t("state.pcGlow") : d.kind === "strip" ? t("state.stripHyper") : t("state.notEntity");
  if (!s) return t("state.unavailable");
  if (d.kind === "sensor") return `${Number(s.state).toFixed(1)} ${String(s.attributes.unit_of_measurement ?? "")}`;
  if (d.kind === "presence") return s.state === "on" ? t("state.someoneHere") : t("state.nobody");
  if (d.kind === "door") return s.state === "on" ? t("state.open") : t("state.closed");
  if (d.kind === "ac")
    return s.state === "off"
      ? t("state.off")
      : t("state.acRunning", {
          mode: isHvacMode(s.state) ? t(`climate.hvac.${s.state}`) : s.state,
          target: String(s.attributes.temperature ?? "?"),
          current: String(s.attributes.current_temperature ?? "?"),
        });
  if (d.kind === "light" || d.kind === "strip" || d.kind === "projector") return isOn(s) ? t("state.on", { pct: brightnessPct(s) }) : t("state.off");
  return s.state;
}

/* ---------------- lights ---------------- */

function LightControls({ entity, whiteOnly }: { entity: string; whiteOnly?: boolean }) {
  const t = useTranslations("homeCards.device");
  const s = useEntity(entity);
  const { patch } = useHomeStates();
  const on = isOn(s);
  const modes = (s?.attributes.supported_color_modes as string[] | undefined) ?? [];
  const hasRgb = !whiteOnly && modes.some((m) => ["rgb", "rgbw", "rgbww", "hs", "xy"].includes(m));
  const hasCt = modes.includes("color_temp");
  const [bri, setBri] = React.useState(brightnessPct(s) || 50);
  const [kelvin, setKelvin] = React.useState(kelvinOf(s) ?? 3000);
  const [hex, setHex] = React.useState(rgbToHex(rgbOf(s) ?? [255, 180, 120]));
  React.useEffect(() => {
    if (s) {
      setBri(brightnessPct(s) || bri);
      const k = kelvinOf(s);
      if (k) setKelvin(k);
      const c = rgbOf(s);
      if (c) setHex(rgbToHex(c));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.last_updated]);

  const minK = (s?.attributes.min_color_temp_kelvin as number | undefined) ?? 2000;
  const maxK = (s?.attributes.max_color_temp_kelvin as number | undefined) ?? 6500;

  const call = async (p: Parameters<typeof setLightAction>[0]) => {
    const r = await setLightAction(p);
    if (!r.ok) toast.error(r.error);
  };

  return (
    <div className="space-y-5">
      <Field inline label={t("power")}>
        <Switch
          checked={on}
          onCheckedChange={async (v) => {
            patch(entity, { state: v ? "on" : "off" });
            const r = await toggleEntityAction({ entity, on: v });
            if (!r.ok) toast.error(r.error);
          }}
          aria-label={t("power")}
        />
      </Field>

      <SliderField label={t("brightness")} value={`${bri}%`}>
        <Slider
          min={1}
          max={100}
          value={bri}
          onChange={setBri}
          onCommit={(v) => {
            patch(entity, { state: "on", attributes: { brightness: Math.round((v / 100) * 255) } });
            call({ entity, brightnessPct: v, transition: 0.3 });
          }}
          track="linear-gradient(90deg, color-mix(in oklch, var(--color-fg) 15%, transparent), var(--color-fg))"
          aria-label={t("brightness")}
        />
      </SliderField>

      {hasCt && (
        <SliderField label={t("warmth")} value={`${kelvin} K`}>
          <Slider
            min={minK}
            max={maxK}
            step={50}
            value={kelvin}
            onChange={setKelvin}
            onCommit={(v) => {
              patch(entity, { state: "on", attributes: { color_temp_kelvin: v, rgb_color: null } });
              call({ entity, kelvin: v, transition: 0.3 });
            }}
            track={`linear-gradient(90deg, ${kelvinToCss(minK)}, ${kelvinToCss((minK + maxK) / 2)}, ${kelvinToCss(maxK)})`}
            aria-label={t("colourTemperature")}
          />
        </SliderField>
      )}

      {hasRgb && (
        <div className="space-y-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <span className="min-w-0 truncate text-sm">{t("colour")}</span>
            <label className="relative inline-flex h-7 w-12 shrink-0 cursor-pointer overflow-hidden rounded-full border border-[var(--color-border)]" style={{ background: hex }}>
              <input
                type="color"
                value={hex}
                onChange={(e) => setHex(e.target.value)}
                onBlur={() => {
                  const rgb = hexToRgb(hex);
                  patch(entity, { state: "on", attributes: { rgb_color: rgb } });
                  call({ entity, rgb, transition: 0.3 });
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label={t("customColour")}
              />
            </label>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={t(`presets.${p.id}`)}
                aria-label={t(`presets.${p.id}`)}
                onClick={() => {
                  setHex(rgbToHex(p.rgb));
                  patch(entity, { state: "on", attributes: { rgb_color: p.rgb } });
                  call({ entity, rgb: p.rgb, transition: 0.4 });
                }}
                className={cn(
                  "aspect-square rounded-full border-2 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]",
                  hex === rgbToHex(p.rgb) ? "border-[var(--color-fg)]" : "border-transparent",
                )}
                style={{ background: `rgb(${p.rgb.join(" ")})` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StaticStrip({ device }: { device: PlacedDevice }) {
  const t = useTranslations("homeCards.device.staticStrip");
  return <p className="text-sm text-muted">{device.id === "dxlight" ? t("dxlight") : t("none")}</p>;
}

/* ---------------- climate ---------------- */

function ClimateControls({ entity }: { entity: string }) {
  const t = useTranslations("homeCards.device.climate");
  const s = useEntity(entity);
  const { patch } = useHomeStates();
  const modes = ((s?.attributes.hvac_modes as string[] | undefined) ?? ["off", "cool", "heat", "dry", "fan_only", "auto"]).filter(isHvacMode);
  const fanModes = (s?.attributes.fan_modes as string[] | undefined) ?? [];
  const target = typeof s?.attributes.temperature === "number" ? s.attributes.temperature : 24;
  const current = s?.attributes.current_temperature as number | undefined;
  const step = (s?.attributes.target_temp_step as number | undefined) ?? 1;

  const setTemp = async (t: number) => {
    patch(entity, { attributes: { temperature: t } });
    const r = await setClimateAction({ entity, temperature: t });
    if (!r.ok) toast.error(r.error);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-center gap-6 py-2">
        <Button variant="outline" size="icon" aria-label={t("lower")} onClick={() => setTemp(Math.max(16, target - step))}>
          <Minus className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <div className="text-5xl font-semibold tabular-nums tracking-tight">{target}°</div>
          <div className="text-xs text-muted">{current !== undefined ? t("room", { t: current }) : t("target")}</div>
        </div>
        <Button variant="outline" size="icon" aria-label={t("raise")} onClick={() => setTemp(Math.min(30, target + step))}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            onClick={async () => {
              patch(entity, { state: m });
              const r = await setClimateAction({ entity, hvacMode: m });
              if (!r.ok) toast.error(r.error);
            }}
            className={cn(
              "min-w-0 truncate rounded-[var(--radius-md)] border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]",
              s?.state === m
                ? "border-[var(--color-primary)] bg-[color-mix(in_oklch,var(--color-primary)_16%,transparent)] text-[var(--color-fg)]"
                : "border-[var(--color-border)] text-muted hover:text-[var(--color-fg)]",
            )}
          >
            {t(`hvac.${m}`)}
          </button>
        ))}
      </div>

      {fanModes.length > 0 && (
        <Field inline label={t("fan")}>
          <NativeSelect
            value={String(s?.attributes.fan_mode ?? "")}
            onChange={async (e) => {
              const r = await setClimateAction({ entity, fanMode: e.target.value });
              if (!r.ok) toast.error(r.error);
            }}
            aria-label={t("fanMode")}
          >
            {fanModes.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
    </div>
  );
}

/* ---------------- media ---------------- */

function MediaControls({ entity }: { entity: string }) {
  const t = useTranslations("homeCards.device.media");
  const s = useEntity(entity);
  const on = isOn(s);
  const vol = typeof s?.attributes.volume_level === "number" ? Math.round(s.attributes.volume_level * 100) : null;
  const send = async (command: Parameters<typeof mediaCommandAction>[0]["command"]) => {
    const r = await mediaCommandAction({ entity, command });
    if (!r.ok) toast.error(r.error);
  };
  return (
    <div className="space-y-4">
      {s?.attributes.media_title ? (
        <p className="truncate text-sm">
          <span className="text-muted">{t("nowPlaying")} · </span>
          {String(s.attributes.media_title)}
        </p>
      ) : null}
      <div className="grid grid-cols-5 gap-2">
        <Button variant={on ? "primary" : "outline"} size="icon" aria-label={on ? t("turnOff") : t("turnOn")} onClick={() => send(on ? "turn_off" : "turn_on")}>
          <Power className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" aria-label={t("playPause")} onClick={() => send("play_pause")} disabled={!on}>
          <Play className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" aria-label={t("volumeDown")} onClick={() => send("volume_down")} disabled={!on}>
          <Volume1 className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" aria-label={t("volumeUp")} onClick={() => send("volume_up")} disabled={!on}>
          <Volume2 className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" aria-label={t("mute")} onClick={() => send("volume_mute")} disabled={!on}>
          <VolumeX className="h-4 w-4" />
        </Button>
      </div>
      {vol !== null && <p className="text-xs tabular-nums text-muted">{t("volume", { pct: vol })}</p>}
    </div>
  );
}

/* ---------------- sensors ---------------- */

function SensorReadout({ device }: { device: PlacedDevice }) {
  const t = useTranslations("homeCards.device");
  const s = useEntity(device.entity);
  if (!s) return null;
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 text-center">
      <div className="text-4xl font-semibold tabular-nums tracking-tight">
        {device.kind === "sensor" ? Number(s.state).toFixed(1) : s.state === "on" ? "●" : "○"}
        <span className="ml-1 text-base text-muted">{String(s.attributes.unit_of_measurement ?? "")}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{t("sensor.updated", { ago: timeAgo(s.last_updated, t) })}</p>
    </div>
  );
}

/* ---------------- extra entities ---------------- */

function ExtraEntities({ ids }: { ids: string[] }) {
  const t = useTranslations("homeCards.device");
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{t("more")}</p>
      <div className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
        {ids.map((id) => (
          <ExtraRow key={id} id={id} />
        ))}
      </div>
    </div>
  );
}

function ExtraRow({ id }: { id: string }) {
  const t = useTranslations("homeCards.device");
  const s = useEntity(id);
  const { patch } = useHomeStates();
  const domain = id.split(".")[0];
  const label = String(s?.attributes.friendly_name ?? id).replace(/^(AC Mami|AC|Mic Enable LED ARGB|Temperature and humidity sensor)\s*/, "");
  if (!s) return null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 truncate text-sm">{label || id}</span>
      {domain === "switch" ? (
        <Switch
          checked={s.state === "on"}
          onCheckedChange={async (v) => {
            patch(id, { state: v ? "on" : "off" });
            const r = await toggleEntityAction({ entity: id, on: v });
            if (!r.ok) toast.error(r.error);
          }}
          aria-label={label}
        />
      ) : domain === "select" ? (
        <NativeSelect
          className="h-8 max-w-[160px] text-xs"
          value={s.state}
          onChange={async (e) => {
            patch(id, { state: e.target.value });
            const r = await selectOptionAction({ entity: id, option: e.target.value });
            if (!r.ok) toast.error(r.error);
          }}
          aria-label={label}
        >
          {((s.attributes.options as string[] | undefined) ?? [s.state]).map((o) => (
            <option key={o} value={o}>
              {o.replace(/_/g, " ")}
            </option>
          ))}
        </NativeSelect>
      ) : domain === "button" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const r = await toggleEntityAction({ entity: id, on: true });
            r.ok ? toast.success(t("sent")) : toast.error(r.error);
          }}
        >
          {t("press")}
        </Button>
      ) : (
        <span className="truncate text-sm tabular-nums text-muted">
          {s.state} {String(s.attributes.unit_of_measurement ?? "")}
        </span>
      )}
    </div>
  );
}

/* ---------------- layout bits ---------------- */

function SliderField({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs text-muted">
        <span className="min-w-0 truncate">{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      {children}
    </div>
  );
}

function timeAgo(iso: string, t: DeviceT) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("timeAgo.justNow");
  if (s < 3600) return t("timeAgo.minutes", { n: Math.floor(s / 60) });
  if (s < 86400) return t("timeAgo.hours", { n: Math.floor(s / 3600) });
  return t("timeAgo.days", { n: Math.floor(s / 86400) });
}

function NativeSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklch,var(--color-primary)_55%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}
