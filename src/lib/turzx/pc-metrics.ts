import "server-only";

/** Host metrics pushed by every PC that runs `turzx.py --publish` while the
 *  renderer lives on the Pi. Keyed by hostname; stale after 15 s so a sleeping
 *  or shut-down machine simply drops out of the rotation. */
type Entry = { at: number; data: Record<string, unknown>; kind: "pc" | "pi" };
const g = globalThis as unknown as { __vmuiPcMetrics__?: Map<string, Entry> };
const store = (g.__vmuiPcMetrics__ instanceof Map ? g.__vmuiPcMetrics__ : (g.__vmuiPcMetrics__ = new Map()));
const TTL_MS = 15_000;

export function setPcMetrics(host: string, data: Record<string, unknown>, kind: "pc" | "pi" = "pc"): void {
  store.set(host, { at: Date.now(), data, kind });
}

/** Every machine seen in the last 15 s, most recent first. */
export function allPcMetrics(): Record<string, Record<string, unknown>> {
  const now = Date.now();
  const out: Record<string, Record<string, unknown>> = {};
  for (const [host, e] of [...store].sort((a, b) => b[1].at - a[1].at)) {
    if (now - e.at >= TTL_MS) store.delete(host);
    else if (e.kind === "pc") out[host] = { ...e.data, _host: host, _at: e.at };
  }
  return out;
}

/** The Raspberry Pi the renderer runs on (turzx.py's _pi_worker mirrors it here). */
export function piMetrics(): Record<string, unknown> | null {
  const e = store.get("homepi");
  return e && e.kind === "pi" && Date.now() - e.at < TTL_MS ? { ...e.data, _at: e.at } : null;
}

/** The primary PC (first publisher) — legacy `pc` field for the focus view. */
export function pcMetrics(): Record<string, unknown> | null {
  return Object.values(allPcMetrics())[0] ?? null;
}
