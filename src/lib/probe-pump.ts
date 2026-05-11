import "server-only";
import { probeInstance, type ProbeMetrics } from "@/lib/probe";

type Listener = (m: ProbeMetrics) => void;

interface Pump {
  listeners: Set<Listener>;
  timer: NodeJS.Timeout | null;
  graceTimer: NodeJS.Timeout | null;
  lastSample: ProbeMetrics | null;
  intervalMs: number;
  busy: boolean;
}

interface Registry {
  pumps: Map<string, Pump>;
}

const KEY = "__vmuiProbePumpRegistry__";

function ensure(): Registry {
  const g = globalThis as unknown as Record<string, Registry | undefined>;
  if (!g[KEY]) g[KEY] = { pumps: new Map() };
  return g[KEY]!;
}

const GRACE_MS = 1500;

export interface ProbePumpHandle {
  unsubscribe: () => void;
  initial: ProbeMetrics | null;
}

export function subscribeProbePump(instanceId: string, intervalMs: number, listener: Listener): ProbePumpHandle {
  const reg = ensure();
  let pump = reg.pumps.get(instanceId);
  if (!pump) {
    pump = {
      listeners: new Set(),
      timer: null,
      graceTimer: null,
      lastSample: null,
      intervalMs,
      busy: false,
    };
    reg.pumps.set(instanceId, pump);
  } else {
    pump.intervalMs = Math.min(pump.intervalMs, intervalMs);
  }
  if (pump.graceTimer) {
    clearTimeout(pump.graceTimer);
    pump.graceTimer = null;
  }
  pump.listeners.add(listener);
  if (!pump.timer) startPump(instanceId, pump);
  return {
    initial: pump.lastSample,
    unsubscribe: () => {
      const p = reg.pumps.get(instanceId);
      if (!p) return;
      p.listeners.delete(listener);
      if (p.listeners.size === 0) {
        p.graceTimer = setTimeout(() => {
          if (p.listeners.size === 0) {
            if (p.timer) clearInterval(p.timer);
            reg.pumps.delete(instanceId);
          }
        }, GRACE_MS);
      }
    },
  };
}

function startPump(instanceId: string, pump: Pump): void {
  const tick = async () => {
    if (pump.busy) return;
    if (pump.listeners.size === 0) return;
    pump.busy = true;
    try {
      const m = await probeInstance(instanceId);
      pump.lastSample = m;
      for (const l of pump.listeners) {
        try {
          l(m);
        } catch {
          /* */
        }
      }
    } catch {
      /* skip tick */
    } finally {
      pump.busy = false;
    }
  };
  void tick();
  pump.timer = setInterval(tick, pump.intervalMs);
  if (typeof pump.timer.unref === "function") pump.timer.unref();
}
