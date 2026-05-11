"use client";

const KEY = "vmui:soundEffects";

export function soundsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setSoundsEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* ignore */ }
}

let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch { return null; }
}

function blip(frequency: number, durationMs: number, type: OscillatorType = "sine", volume = 0.05) {
  if (!soundsEnabled()) return;
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.value = volume;
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + durationMs / 1000);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + durationMs / 1000);
}

export const sfx = {
  ok: () => blip(880, 120, "sine"),
  warn: () => blip(440, 200, "triangle", 0.07),
  error: () => { blip(220, 180, "sawtooth", 0.08); setTimeout(() => blip(180, 180, "sawtooth", 0.08), 90); },
  click: () => blip(1200, 30, "square", 0.03),
};
