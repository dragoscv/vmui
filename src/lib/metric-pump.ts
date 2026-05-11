import "server-only";

import type { InstanceStatsSample } from "@/lib/providers/types";

/**
 * Shared per-instance metric pump. Many tabs/components might want the same
 * instance's stats; rather than each spawning its own polling loop (and
 * spawning its own bash sampler for local-kvm), they all subscribe to one
 * pump. The pump starts when the first subscriber attaches and stops when
 * the last leaves, after a short grace period to absorb React StrictMode
 * remounts.
 */

type Listener = (sample: InstanceStatsSample) => void;

interface Pump {
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval> | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  lastSample: InstanceStatsSample | null;
  fetchOnce: () => Promise<InstanceStatsSample | null>;
  intervalMs: number;
  busy: boolean;
}

interface Registry {
  pumps: Map<string, Pump>;
}

declare global {
  // eslint-disable-next-line no-var
  var __vmuiMetricPumps__: Registry | undefined;
}

function ensure(): Registry {
  if (!globalThis.__vmuiMetricPumps__) {
    globalThis.__vmuiMetricPumps__ = { pumps: new Map() };
  }
  return globalThis.__vmuiMetricPumps__;
}

const GRACE_MS = 1500;

export interface PumpHandle {
  unsubscribe: () => void;
  /** Latest sample if one was already cached when the subscriber attached. */
  initial: InstanceStatsSample | null;
}

export function subscribeMetricPump(
  key: string,
  fetchOnce: () => Promise<InstanceStatsSample | null>,
  intervalMs: number,
  listener: Listener,
): PumpHandle {
  const reg = ensure();
  let pump = reg.pumps.get(key);
  if (!pump) {
    pump = {
      listeners: new Set(),
      timer: null,
      graceTimer: null,
      lastSample: null,
      fetchOnce,
      intervalMs,
      busy: false,
    };
    reg.pumps.set(key, pump);
  } else {
    // Refresh the closure so the freshest fetcher (with current creds) wins,
    // but keep the existing listener set + timer alive.
    pump.fetchOnce = fetchOnce;
    pump.intervalMs = Math.min(pump.intervalMs, intervalMs);
  }
  if (pump.graceTimer) {
    clearTimeout(pump.graceTimer);
    pump.graceTimer = null;
  }
  pump.listeners.add(listener);
  if (!pump.timer) startPump(key, pump);
  return {
    initial: pump.lastSample,
    unsubscribe: () => {
      const p = reg.pumps.get(key);
      if (!p) return;
      p.listeners.delete(listener);
      if (p.listeners.size === 0) {
        p.graceTimer = setTimeout(() => {
          if (p.listeners.size === 0) {
            if (p.timer) clearInterval(p.timer);
            reg.pumps.delete(key);
          }
        }, GRACE_MS);
      }
    },
  };
}

function startPump(key: string, pump: Pump) {
  const tick = async () => {
    if (pump.busy) return;
    if (pump.listeners.size === 0) return;
    pump.busy = true;
    try {
      const sample = await pump.fetchOnce();
      if (!sample) return;
      pump.lastSample = sample;
      for (const l of pump.listeners) {
        try {
          l(sample);
        } catch {
          /* a misbehaving subscriber must not break the pump */
        }
      }
    } catch {
      /* skip this tick */
    } finally {
      pump.busy = false;
    }
  };
  // Fire immediately so the first SSE client sees a sample without a delay.
  void tick();
  pump.timer = setInterval(tick, pump.intervalMs);
  if (typeof pump.timer.unref === "function") pump.timer.unref();
  // Reference the key so it stays in scope (helps ESLint, no behavior change).
  void key;
}
