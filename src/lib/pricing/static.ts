import "server-only";
import type { PriceQuote } from "./types";

/**
 * Curated table of common on-demand hourly prices in USD. Used as the
 * instant-paint default — the live AWS Pricing API will overwrite this in
 * the background when available.
 *
 * Region pricing varies, but the spread is usually <10% across most regions
 * for the major instance families. We store us-east-1 numbers and apply a
 * coarse regional multiplier from REGION_MULT below for everything else.
 *
 * Sources: AWS public price list (us-east-1), Scaleway public catalog,
 * Hetzner cloud pricing pages. Numbers as of 2026-Q1; refresh when AWS
 * publishes new SKUs.
 */
const AWS_BASE: Record<string, { linux?: number; windows?: number; mac?: number }> = {
  // Burstable
  "t3.nano": { linux: 0.0052, windows: 0.0098 },
  "t3.micro": { linux: 0.0104, windows: 0.0196 },
  "t3.small": { linux: 0.0208, windows: 0.0392 },
  "t3.medium": { linux: 0.0416, windows: 0.0784 },
  "t3.large": { linux: 0.0832, windows: 0.1568 },
  "t3.xlarge": { linux: 0.1664, windows: 0.3136 },
  "t3.2xlarge": { linux: 0.3328, windows: 0.6272 },
  "t4g.nano": { linux: 0.0042 },
  "t4g.micro": { linux: 0.0084 },
  "t4g.small": { linux: 0.0168 },
  "t4g.medium": { linux: 0.0336 },
  // General purpose
  "m6i.large": { linux: 0.096, windows: 0.188 },
  "m6i.xlarge": { linux: 0.192, windows: 0.376 },
  "m6i.2xlarge": { linux: 0.384, windows: 0.752 },
  "m6i.4xlarge": { linux: 0.768, windows: 1.504 },
  "m7i.large": { linux: 0.1008, windows: 0.198 },
  "m7i.xlarge": { linux: 0.2016, windows: 0.396 },
  // Compute optimised
  "c6i.large": { linux: 0.085, windows: 0.177 },
  "c6i.xlarge": { linux: 0.17, windows: 0.354 },
  "c7i.large": { linux: 0.0893, windows: 0.181 },
  // Memory optimised
  "r6i.large": { linux: 0.126, windows: 0.218 },
  "r6i.xlarge": { linux: 0.252, windows: 0.436 },
  // Mac instances — billed against the Dedicated Host (24h minimum)
  "mac1.metal": { mac: 1.083 },
  "mac2.metal": { mac: 0.6498 },
  "mac2-m2.metal": { mac: 0.7458 },
  "mac2-m2pro.metal": { mac: 0.8978 },
  "mac-m4.metal": { mac: 0.7458 },
  "mac-m4pro.metal": { mac: 1.183 },
};

/** Coarse regional multiplier vs. us-east-1 (1.0). */
const REGION_MULT: Record<string, number> = {
  "us-east-1": 1,
  "us-east-2": 1,
  "us-west-1": 1.04,
  "us-west-2": 1,
  "eu-west-1": 1.05,
  "eu-west-2": 1.06,
  "eu-west-3": 1.07,
  "eu-central-1": 1.07,
  "eu-north-1": 0.98,
  "eu-south-1": 1.06,
  "ap-northeast-1": 1.13,
  "ap-northeast-2": 1.05,
  "ap-southeast-1": 1.08,
  "ap-southeast-2": 1.10,
  "ap-south-1": 0.92,
  "ca-central-1": 1.04,
  "sa-east-1": 1.30,
  "me-south-1": 1.07,
  "af-south-1": 1.13,
};

/** Scaleway: fixed monthly + hourly cap; we just use hourly. */
const SCALEWAY_BASE: Record<string, number> = {
  // EM-A1-M (Apple silicon Mac mini bare metal)
  "EM-A1-M": 0.114, // ≈€0.105/hr
  "EM-A210R-M": 0.13,
  // Generic VPS-DEV / GP families
  "DEV1-S": 0.01,
  "DEV1-M": 0.02,
  "DEV1-L": 0.04,
  "DEV1-XL": 0.08,
  "GP1-XS": 0.05,
  "GP1-S": 0.10,
  "GP1-M": 0.20,
  "GP1-L": 0.40,
};

const AZURE_BASE: Record<string, { linux?: number; windows?: number }> = {
  "Standard_B1s": { linux: 0.0104, windows: 0.0188 },
  "Standard_B2s": { linux: 0.0416, windows: 0.0832 },
  "Standard_B2ms": { linux: 0.0832, windows: 0.1664 },
  "Standard_D2s_v5": { linux: 0.096, windows: 0.192 },
  "Standard_D4s_v5": { linux: 0.192, windows: 0.384 },
  "Standard_D8s_v5": { linux: 0.384, windows: 0.768 },
  "Standard_E2s_v5": { linux: 0.126, windows: 0.222 },
  "Standard_F2s_v2": { linux: 0.0846, windows: 0.1798 },
  "Standard_F4s_v2": { linux: 0.169, windows: 0.359 },
};

const GCP_BASE: Record<string, { linux?: number; windows?: number }> = {
  "e2-micro": { linux: 0.00838, windows: 0.0214 },
  "e2-small": { linux: 0.01675, windows: 0.0428 },
  "e2-medium": { linux: 0.0335, windows: 0.0856 },
  "e2-standard-2": { linux: 0.067, windows: 0.171 },
  "e2-standard-4": { linux: 0.134, windows: 0.342 },
  "n2-standard-2": { linux: 0.0971, windows: 0.201 },
  "n2-standard-4": { linux: 0.1942, windows: 0.402 },
  "c3-standard-4": { linux: 0.207, windows: 0.41 },
};

/** DigitalOcean droplets — flat hourly, billed monthly cap (730h). Linux only. */
const DIGITALOCEAN_BASE: Record<string, number> = {
  "s-1vcpu-1gb": 0.00744,
  "s-1vcpu-2gb": 0.01488,
  "s-2vcpu-2gb": 0.02232,
  "s-2vcpu-4gb": 0.03571,
  "s-4vcpu-8gb": 0.07143,
  "s-8vcpu-16gb": 0.14286,
  "c-2": 0.06,
  "c-4": 0.12,
  "g-2vcpu-8gb": 0.09375,
  "g-4vcpu-16gb": 0.1875,
  "m-2vcpu-16gb": 0.13393,
  "m-4vcpu-32gb": 0.26786,
};

function platformKey(p: string): "linux" | "windows" | "mac" {
  const x = p.toLowerCase();
  if (x.includes("win")) return "windows";
  if (x.includes("mac")) return "mac";
  return "linux";
}

export function lookupStaticPrice(
  provider: string,
  region: string,
  instanceType: string,
  platform: string,
): PriceQuote | null {
  const pk = platformKey(platform);
  if (provider === "aws") {
    const base = AWS_BASE[instanceType];
    if (!base) return null;
    const baseUsd = base[pk];
    if (baseUsd == null) return null;
    const mult = REGION_MULT[region] ?? 1;
    return { usdPerHour: +(baseUsd * mult).toFixed(5), source: "static" };
  }
  if (provider === "scaleway") {
    const usd = SCALEWAY_BASE[instanceType];
    return usd == null ? null : { usdPerHour: usd, source: "static" };
  }
  if (provider === "azure") {
    const base = AZURE_BASE[instanceType];
    if (!base) return null;
    const baseUsd = base[pk === "mac" ? "linux" : pk];
    return baseUsd == null ? null : { usdPerHour: baseUsd, source: "static" };
  }
  if (provider === "gcp") {
    const base = GCP_BASE[instanceType];
    if (!base) return null;
    const baseUsd = base[pk === "mac" ? "linux" : pk];
    return baseUsd == null ? null : { usdPerHour: baseUsd, source: "static" };
  }
  if (provider === "digitalocean") {
    const usd = DIGITALOCEAN_BASE[instanceType];
    return usd == null ? null : { usdPerHour: usd, source: "static" };
  }
  if (provider === "local-kvm") {
    return { usdPerHour: 0, source: "kvm-free" };
  }
  return null;
}

/**
 * AWS instance-type ladders ordered from smallest to largest. Used by the
 * rightsizing recommender to pick the next-smaller type when CPU usage is
 * sustainably low. Only covers families we also price in `AWS_BASE`; types
 * outside the ladder yield `null` ("can't recommend automatically").
 */
const AWS_FAMILY_LADDERS: Record<string, string[]> = {
  t3: ["t3.nano", "t3.micro", "t3.small", "t3.medium", "t3.large", "t3.xlarge", "t3.2xlarge"],
  t4g: ["t4g.nano", "t4g.micro", "t4g.small", "t4g.medium"],
  m6i: ["m6i.large", "m6i.xlarge", "m6i.2xlarge", "m6i.4xlarge"],
  m7i: ["m7i.large", "m7i.xlarge"],
  c6i: ["c6i.large", "c6i.xlarge"],
  c7i: ["c7i.large"],
  r6i: ["r6i.large", "r6i.xlarge"],
};

/**
 * Return the next-smaller AWS instance type in the same family, or null
 * when the current type is already the smallest (or unknown).
 */
export function nextSmallerAwsType(instanceType: string): string | null {
  const dot = instanceType.indexOf(".");
  if (dot < 1) return null;
  const family = instanceType.slice(0, dot);
  const ladder = AWS_FAMILY_LADDERS[family];
  if (!ladder) return null;
  const idx = ladder.indexOf(instanceType);
  if (idx <= 0) return null;
  return ladder[idx - 1] ?? null;
}
