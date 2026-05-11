import "server-only";

/**
 * In-memory token-bucket-style rate limiter. Lives on `globalThis` so HMR
 * doesn't reset it during development. Keys are arbitrary strings — typically
 * `${bucket}:${ip}` or `${bucket}:${userId}`. Use {@link rateLimit} for the
 * common "N attempts per window" pattern; use {@link rateLimitDelay} when you
 * want a sliding back-off (e.g. failed sign-ins).
 */

interface Bucket {
  count: number;
  resetAt: number;
}

interface Store {
  buckets: Map<string, Bucket>;
}

declare global {
  // eslint-disable-next-line no-var
  var __vmuiRateLimit__: Store | undefined;
}

function store(): Store {
  if (!globalThis.__vmuiRateLimit__) {
    globalThis.__vmuiRateLimit__ = { buckets: new Map() };
  }
  return globalThis.__vmuiRateLimit__;
}

export interface RateLimitResult {
  ok: boolean;
  /** How many requests are still allowed in the current window. */
  remaining: number;
  /** Seconds until the window resets. */
  resetInSec: number;
}

export function rateLimit(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  const s = store();
  let b = s.buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowSec * 1000 };
    s.buckets.set(key, b);
  }
  b.count += 1;
  const ok = b.count <= limit;
  return {
    ok,
    remaining: Math.max(0, limit - b.count),
    resetInSec: Math.max(0, Math.ceil((b.resetAt - now) / 1000)),
  };
}

export function resetRateLimit(key: string): void {
  store().buckets.delete(key);
}

/**
 * Sliding-window failure tracker — returns the number of consecutive failures
 * and a recommended delay (linear back-off, capped at 8s). Call
 * `recordFailure(key)` after a failed attempt and `clearFailures(key)` on
 * success.
 */
interface FailureStore {
  failures: Map<string, { n: number; lastAt: number }>;
}
declare global {
  // eslint-disable-next-line no-var
  var __vmuiFailures__: FailureStore | undefined;
}
function failures(): FailureStore {
  if (!globalThis.__vmuiFailures__) {
    globalThis.__vmuiFailures__ = { failures: new Map() };
  }
  return globalThis.__vmuiFailures__;
}

export function recordFailure(key: string): { count: number; delayMs: number } {
  const f = failures();
  const prev = f.failures.get(key);
  // Decay: forget anything older than 15 min.
  const fresh = prev && Date.now() - prev.lastAt < 15 * 60_000 ? prev.n : 0;
  const n = fresh + 1;
  f.failures.set(key, { n, lastAt: Date.now() });
  const delayMs = Math.min(8_000, n * 500);
  return { count: n, delayMs };
}

export function clearFailures(key: string): void {
  failures().failures.delete(key);
}

export function failureCount(key: string): number {
  const prev = failures().failures.get(key);
  if (!prev) return 0;
  if (Date.now() - prev.lastAt >= 15 * 60_000) return 0;
  return prev.n;
}
