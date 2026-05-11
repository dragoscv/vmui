import { describe, it, expect } from "vitest";
import { lookupStaticPrice } from "./static";

describe("lookupStaticPrice", () => {
  it("returns kvm-free for local-kvm regardless of type", () => {
    const r = lookupStaticPrice("local-kvm", "any-region", "any-type", "linux");
    expect(r).not.toBeNull();
    expect(r!.usdPerHour).toBe(0);
    expect(r!.source).toBe("kvm-free");
  });

  it("returns null for unknown AWS instance types", () => {
    const r = lookupStaticPrice("aws", "us-east-1", "unicorn.42xlarge", "linux");
    expect(r).toBeNull();
  });

  it("scales AWS pricing by regional multiplier", () => {
    const useast = lookupStaticPrice("aws", "us-east-1", "t3.micro", "linux");
    const eu = lookupStaticPrice("aws", "eu-west-1", "t3.micro", "linux");
    expect(useast).not.toBeNull();
    expect(eu).not.toBeNull();
    if (useast && eu) {
      expect(eu.usdPerHour).toBeGreaterThanOrEqual(useast.usdPerHour);
    }
  });

  it("returns prices for Azure Standard_B2s in westeurope", () => {
    const r = lookupStaticPrice("azure", "westeurope", "Standard_B2s", "linux");
    expect(r).not.toBeNull();
    expect(r!.usdPerHour).toBeGreaterThan(0);
  });

  it("returns prices for GCP e2-micro in us-central1-a", () => {
    const r = lookupStaticPrice("gcp", "us-central1-a", "e2-micro", "linux");
    expect(r).not.toBeNull();
  });
});
