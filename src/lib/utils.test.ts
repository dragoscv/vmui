import { describe, it, expect } from "vitest";
import { formatUsd, formatUsdPerHour, HOURS_PER_MONTH } from "./utils";

describe("formatUsd", () => {
  it("renders dollar amounts with 2 decimal places", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe("formatUsdPerHour", () => {
  it("uses 4 decimals under 1 cent", () => {
    expect(formatUsdPerHour(0.0042)).toBe("$0.0042/hr");
  });
  it("uses 3 decimals under one dollar", () => {
    expect(formatUsdPerHour(0.213)).toBe("$0.213/hr");
  });
  it("uses 2 decimals over one dollar", () => {
    expect(formatUsdPerHour(2.5)).toBe("$2.50/hr");
  });
  it("returns 'free' for zero", () => {
    expect(formatUsdPerHour(0)).toBe("free");
  });
});

describe("HOURS_PER_MONTH", () => {
  it("is 730 (industry-standard avg)", () => {
    expect(HOURS_PER_MONTH).toBe(730);
  });
});
