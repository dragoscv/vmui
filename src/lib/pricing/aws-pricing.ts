import "server-only";
import { PricingClient, GetProductsCommand } from "@aws-sdk/client-pricing";
import type { PriceQuote } from "./types";

/**
 * AWS Price List Query API endpoints exist only in us-east-1 and ap-south-1.
 * The `Location` filter expects a long region name like "EU (Ireland)" rather
 * than "eu-west-1", so we maintain a small lookup table for the common ones.
 */
const REGION_TO_LOCATION: Record<string, string> = {
  "us-east-1": "US East (N. Virginia)",
  "us-east-2": "US East (Ohio)",
  "us-west-1": "US West (N. California)",
  "us-west-2": "US West (Oregon)",
  "ca-central-1": "Canada (Central)",
  "sa-east-1": "South America (Sao Paulo)",
  "eu-west-1": "EU (Ireland)",
  "eu-west-2": "EU (London)",
  "eu-west-3": "EU (Paris)",
  "eu-central-1": "EU (Frankfurt)",
  "eu-north-1": "EU (Stockholm)",
  "eu-south-1": "EU (Milan)",
  "ap-northeast-1": "Asia Pacific (Tokyo)",
  "ap-northeast-2": "Asia Pacific (Seoul)",
  "ap-northeast-3": "Asia Pacific (Osaka)",
  "ap-southeast-1": "Asia Pacific (Singapore)",
  "ap-southeast-2": "Asia Pacific (Sydney)",
  "ap-southeast-3": "Asia Pacific (Jakarta)",
  "ap-south-1": "Asia Pacific (Mumbai)",
  "me-south-1": "Middle East (Bahrain)",
  "af-south-1": "Africa (Cape Town)",
};

interface AwsPricingCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * Query the live AWS Price List API for one EC2 instance type. Filters
 * down to On-Demand, Shared tenancy, no pre-installed software. Returns
 * the cheapest matching SKU's price.
 */
export async function fetchAwsPrice(
  creds: AwsPricingCredentials,
  region: string,
  instanceType: string,
  platform: string,
): Promise<PriceQuote | null> {
  const location = REGION_TO_LOCATION[region];
  if (!location) return null;

  const client = new PricingClient({
    region: "us-east-1",
    credentials: creds,
  });

  const filters = [
    { Type: "TERM_MATCH" as const, Field: "ServiceCode", Value: "AmazonEC2" },
    { Type: "TERM_MATCH" as const, Field: "instanceType", Value: instanceType },
    { Type: "TERM_MATCH" as const, Field: "location", Value: location },
    { Type: "TERM_MATCH" as const, Field: "tenancy", Value: "Shared" },
    { Type: "TERM_MATCH" as const, Field: "preInstalledSw", Value: "NA" },
    { Type: "TERM_MATCH" as const, Field: "capacitystatus", Value: "Used" },
    {
      Type: "TERM_MATCH" as const,
      Field: "operatingSystem",
      Value: platform === "windows" ? "Windows" : "Linux",
    },
  ];

  const cmd = new GetProductsCommand({
    ServiceCode: "AmazonEC2",
    Filters: filters,
    MaxResults: 5,
  });

  let products: string[];
  try {
    const r = await client.send(cmd);
    products = r.PriceList?.map((p: unknown) => (typeof p === "string" ? p : JSON.stringify(p))) ?? [];
  } catch {
    return null;
  }

  let cheapest: number | null = null;
  for (const p of products) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(p);
    } catch {
      continue;
    }
    const onDemand = (parsed as { terms?: { OnDemand?: Record<string, unknown> } }).terms?.OnDemand;
    if (!onDemand) continue;
    for (const term of Object.values(onDemand)) {
      const dims = (term as { priceDimensions?: Record<string, unknown> }).priceDimensions;
      if (!dims) continue;
      for (const dim of Object.values(dims)) {
        const usd = (dim as { pricePerUnit?: { USD?: string } }).pricePerUnit?.USD;
        if (!usd) continue;
        const v = Number(usd);
        if (!Number.isFinite(v) || v <= 0) continue;
        if (cheapest === null || v < cheapest) cheapest = v;
      }
    }
  }

  return cheapest === null ? null : { usdPerHour: cheapest, source: "aws-pricing-api" };
}
