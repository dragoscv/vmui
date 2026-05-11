import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, resetRateLimit, recordFailure, clearFailures, failureCount } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    resetRateLimit("test");
    clearFailures("test");
  });

  it("allows up to `limit` requests per window then rejects", () => {
    for (let i = 0; i < 3; i++) {
      const r = rateLimit("test", 3, 60);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(3 - (i + 1));
    }
    const r = rateLimit("test", 3, 60);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("reports seconds remaining in the window", () => {
    const r = rateLimit("test", 1, 60);
    expect(r.ok).toBe(true);
    expect(r.resetInSec).toBeGreaterThan(0);
    expect(r.resetInSec).toBeLessThanOrEqual(60);
  });

  it("keeps separate buckets per key", () => {
    rateLimit("a", 1, 60);
    rateLimit("a", 1, 60);
    expect(rateLimit("a", 1, 60).ok).toBe(false);
    expect(rateLimit("b", 1, 60).ok).toBe(true);
  });
});

describe("failures", () => {
  beforeEach(() => clearFailures("user"));

  it("returns a back-off proportional to attempts, capped", () => {
    const a = recordFailure("user");
    expect(a.count).toBe(1);
    expect(a.delayMs).toBe(500);
    const b = recordFailure("user");
    expect(b.count).toBe(2);
    expect(b.delayMs).toBe(1000);
    for (let i = 0; i < 30; i++) recordFailure("user");
    const final = recordFailure("user");
    expect(final.delayMs).toBe(8000);
  });

  it("clearFailures resets the counter", () => {
    recordFailure("user");
    recordFailure("user");
    expect(failureCount("user")).toBe(2);
    clearFailures("user");
    expect(failureCount("user")).toBe(0);
  });
});
