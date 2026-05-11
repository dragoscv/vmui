import { describe, it, expect } from "vitest";
import { spotSavings } from "./spot";

describe("spotSavings", () => {
  it("returns no savings for null hourly", () => {
    expect(spotSavings("aws", null)).toEqual({
      discountFactor: 0,
      potentialMonthlySavingsUsd: 0,
      spotEligible: false,
    });
  });

  it("returns 0 for providers without spot support", () => {
    expect(spotSavings("scaleway", 1)).toEqual({
      discountFactor: 0,
      potentialMonthlySavingsUsd: 0,
      spotEligible: false,
    });
    expect(spotSavings("local-kvm", 1)).toEqual({
      discountFactor: 0,
      potentialMonthlySavingsUsd: 0,
      spotEligible: false,
    });
  });

  it("returns AWS spot savings = 70% of monthly", () => {
    const r = spotSavings("aws", 1);
    expect(r.spotEligible).toBe(true);
    expect(r.discountFactor).toBeCloseTo(0.7, 5);
    expect(r.potentialMonthlySavingsUsd).toBeCloseTo(0.7 * 730, 5);
  });

  it("returns GCP spot savings = 70% of monthly", () => {
    const r = spotSavings("gcp", 0.5);
    expect(r.potentialMonthlySavingsUsd).toBeCloseTo(0.5 * 0.7 * 730, 5);
  });
});
