import { describe, it, expect } from "vitest";
import { isValidCron, parseCron, matchesNow, nextRuns } from "./cron";

describe("cron", () => {
  it("validates standard 5-field expressions", () => {
    expect(isValidCron("0 19 * * 1-5")).toBe(true);
    expect(isValidCron("*/5 * * * *")).toBe(true);
    expect(isValidCron("0,15,30,45 * * * *")).toBe(true);
    expect(isValidCron("0 8 * * 0,7")).toBe(true);
  });

  it("rejects malformed expressions", () => {
    expect(isValidCron("")).toBe(false);
    expect(isValidCron("* * * *")).toBe(false);
    expect(isValidCron("60 * * * *")).toBe(true); // out-of-range allowed by parseCron — only matchesNow rejects
    expect(isValidCron("a * * * *")).toBe(false);
  });

  it("expands ranges + steps", () => {
    const p = parseCron("*/15 9-17 * * 1-5");
    expect([...p.minute].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
    expect([...p.hour].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...p.dow].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("dow 7 normalizes to 0 (Sunday)", () => {
    const p = parseCron("0 8 * * 7");
    expect([...p.dow]).toEqual([0]);
  });

  it("matchesNow returns true for the matching minute only", () => {
    // Mon 2024-01-01 was a Monday; 19:00 -> matches "0 19 * * 1-5"
    const monAt19 = new Date(2024, 0, 1, 19, 0, 0);
    const monAt19_01 = new Date(2024, 0, 1, 19, 1, 0);
    const sunAt19 = new Date(2024, 0, 7, 19, 0, 0);
    expect(matchesNow("0 19 * * 1-5", monAt19)).toBe(true);
    expect(matchesNow("0 19 * * 1-5", monAt19_01)).toBe(false);
    expect(matchesNow("0 19 * * 1-5", sunAt19)).toBe(false);
  });

  it("nextRuns returns up to N upcoming run timestamps in order", () => {
    // Mon 2024-01-01 00:00 — cron fires weekdays 19:00
    const from = new Date(2024, 0, 1, 0, 0, 0);
    const runs = nextRuns("0 19 * * 1-5", 5, from);
    expect(runs).toHaveLength(5);
    expect(runs[0]!.getDate()).toBe(1); // Mon
    expect(runs[0]!.getHours()).toBe(19);
    expect(runs[1]!.getDate()).toBe(2); // Tue
    expect(runs[4]!.getDate()).toBe(5); // Fri
    // Strictly increasing
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]!.getTime()).toBeGreaterThan(runs[i - 1]!.getTime());
    }
  });

  it("nextRuns stops when no further matches exist within a year", () => {
    // Impossible: Feb 30
    const runs = nextRuns("0 0 30 2 *", 5, new Date(2024, 0, 1));
    expect(runs).toHaveLength(0);
  });
});
