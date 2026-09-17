import "server-only";

/** Host metrics pushed by every PC that runs `turzx.py --publish` while the
 *  renderer lives on the Pi. Keyed by hostname; stale after 15 s so a sleeping
 *  or shut-down machine simply drops out of the rotation. */
type Entry = { at: number; data: Record<string, unknown> };
const g = globalThis as unknown as { __vmuiPcMetrics__?: Map<string, Entry> };
const store = (g.__vmuiPcMetrics__ instanceof Map ? g.__vmuiPcMetrics__ : (g.__vmuiPcMetrics__ = new Map()));
const TTL_MS = 15_000;

export function setPcMetrics(host: string, data: Record<string, unknown>): void {
  store.set(host, { at: Date.now(), data });
}

/** Every machine seen in the last 15 s, most recent first. */
export function allPcMetrics(): Record<string, Record<string, unknown>> {
  const now = Date.now();
  const out: Record<string, Record<string, unknown>> = {};
  for (const [host, e] of [...store].sort((a, b) => b[1].at - a[1].at)) {
    if (now - e.at < TTL_MS) out[host] = { ...e.data, _host: host, _at: e.at };
    else store.delete(host);
  }
  return out;
}

/** The primary PC (first publisher) — legacy `pc` field for the focus view. */
export function pcMetrics(): Record<string, unknown> | null {
  return Object.values(allPcMetrics())[0] ?? null;
}
