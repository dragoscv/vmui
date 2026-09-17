import "server-only";

/** Host metrics pushed by the PC (`turzx.py --publish`) when the renderer runs
 *  on the Pi. Process-local; stale after 15 s so a sleeping PC shows as gone. */
const g = globalThis as unknown as { __vmuiPcMetrics__?: { at: number; data: Record<string, unknown> } };

export function setPcMetrics(data: Record<string, unknown>): void {
  g.__vmuiPcMetrics__ = { at: Date.now(), data };
}

export function pcMetrics(): Record<string, unknown> | null {
  const m = g.__vmuiPcMetrics__;
  return m && Date.now() - m.at < 15_000 ? m.data : null;
}
