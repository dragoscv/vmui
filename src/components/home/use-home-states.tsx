"use client";

import type { HaState } from "@/lib/home/ha-client";
import * as React from "react";

type Ctx = {
  states: Record<string, HaState>;
  live: "connecting" | "live" | "offline";
  /** Optimistic write; the next SSE frame for the entity wins. */
  patch: (entityId: string, next: Partial<Pick<HaState, "state" | "attributes">>) => void;
};

const HomeStatesContext = React.createContext<Ctx | null>(null);

export function HomeStatesProvider({ initial, children }: { initial: Record<string, HaState>; children: React.ReactNode }) {
  const [states, setStates] = React.useState(initial);
  const [live, setLive] = React.useState<Ctx["live"]>("connecting");

  React.useEffect(() => {
    let es: EventSource | null = null;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      es = new EventSource("/api/home/events");
      es.addEventListener("ready", () => {
        retry = 1000;
        setLive("live");
      });
      es.addEventListener("state", (ev) => {
        const s = JSON.parse((ev as MessageEvent).data) as HaState;
        setStates((prev) => ({ ...prev, [s.entity_id]: s }));
      });
      es.onerror = () => {
        es?.close();
        setLive("offline");
        if (stopped) return;
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 15_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const patch = React.useCallback<Ctx["patch"]>((entityId, next) => {
    setStates((prev) => {
      const cur = prev[entityId];
      if (!cur) return prev;
      return {
        ...prev,
        [entityId]: {
          ...cur,
          state: next.state ?? cur.state,
          attributes: { ...cur.attributes, ...(next.attributes ?? {}) },
        },
      };
    });
  }, []);

  const value = React.useMemo(() => ({ states, live, patch }), [states, live, patch]);
  return <HomeStatesContext.Provider value={value}>{children}</HomeStatesContext.Provider>;
}

export function useHomeStates() {
  const ctx = React.useContext(HomeStatesContext);
  if (!ctx) throw new Error("useHomeStates outside HomeStatesProvider");
  return ctx;
}

export function useEntity(entityId?: string) {
  const { states } = useHomeStates();
  return entityId ? states[entityId] : undefined;
}

/* ---------- small pure helpers shared by tiles and sheets ---------- */

export function isOn(s?: HaState) {
  return s ? !["off", "unavailable", "unknown", "idle", "standby"].includes(s.state) : false;
}

export function rgbOf(s?: HaState): [number, number, number] | null {
  const v = s?.attributes.rgb_color;
  return Array.isArray(v) && v.length === 3 ? (v as [number, number, number]) : null;
}

export function brightnessPct(s?: HaState): number {
  const b = s?.attributes.brightness;
  return typeof b === "number" ? Math.round((b / 255) * 100) : 0;
}

export function kelvinOf(s?: HaState): number | null {
  const k = s?.attributes.color_temp_kelvin;
  return typeof k === "number" ? k : null;
}

export function cssColor(s?: HaState, fallback = "oklch(0.82 0.12 80)") {
  if (!isOn(s)) return null;
  const rgb = rgbOf(s);
  if (rgb) return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
  const k = kelvinOf(s);
  if (k) return kelvinToCss(k);
  return fallback;
}

export function kelvinToCss(k: number) {
  // Warm 2000K → cool 6500K, perceptual enough for a UI swatch.
  const t = Math.min(1, Math.max(0, (k - 2000) / 4500));
  const hue = 70 - t * 30 + (t > 0.7 ? (t - 0.7) * 500 : 0);
  const chroma = 0.14 - t * 0.1;
  return `oklch(0.9 ${chroma.toFixed(3)} ${hue.toFixed(0)})`;
}

export function rgbToHex([r, g, b]: [number, number, number]) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
