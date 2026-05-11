import "server-only";
import { JWT } from "google-auth-library";
import type { PriceQuote } from "./types";

/**
 * GCP Cloud Billing Catalog API. Public — no project, but billing-account
 * scope is required. We use the service-account JWT scoped to
 * cloud-platform.read-only and read the public "Compute Engine" SKUs.
 *
 * The catalog is huge; we filter by serviceId (Compute Engine = 6F81-5844-456A)
 * and resourceFamily="Compute". Pricing for one machine type per region
 * usually shows up across multiple SKUs (CPU + RAM separately). We sum them.
 */
const COMPUTE_ENGINE_SERVICE_ID = "services/6F81-5844-456A";

interface SkuPricingExpression {
  usageUnit?: string;
  tieredRates?: Array<{ unitPrice?: { units?: string; nanos?: number } }>;
}
interface Sku {
  name?: string;
  description?: string;
  category?: { resourceFamily?: string; resourceGroup?: string; usageType?: string };
  serviceRegions?: string[];
  pricingInfo?: Array<{ pricingExpression?: SkuPricingExpression }>;
}

function unitPriceUsd(p: SkuPricingExpression | undefined): number | null {
  const tier = p?.tieredRates?.[0]?.unitPrice;
  if (!tier) return null;
  const units = Number(tier.units ?? 0);
  const nanos = Number(tier.nanos ?? 0) / 1e9;
  const v = units + nanos;
  return v > 0 ? v : null;
}

function machineFamily(instanceType: string): string {
  // e.g. "e2-standard-4" -> "e2", "n2-highcpu-8" -> "n2"
  const dash = instanceType.indexOf("-");
  return dash > 0 ? instanceType.slice(0, dash) : instanceType;
}

function vcpuCount(instanceType: string): number | null {
  // "*-{n}" -> n. Heuristic; works for most standard sizes.
  const m = /-([0-9]+)$/.exec(instanceType);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

interface GcpPricingCredentials {
  client_email: string;
  private_key: string;
}

/**
 * Fetch on-demand price for one GCP machine type. Returns the SUM of CPU
 * and RAM SKU prices for that family in the requested region. Falls back to
 * null if the catalog page can't be parsed or the SKUs aren't found.
 *
 * GCP zones map to regions: "europe-west1-b" -> "europe-west1".
 */
export async function fetchGcpPrice(
  creds: GcpPricingCredentials,
  zoneOrRegion: string,
  instanceType: string,
  platform: string,
): Promise<PriceQuote | null> {
  const region = zoneOrRegion.replace(/-[a-z]$/, "");
  const family = machineFamily(instanceType).toUpperCase();
  const cpus = vcpuCount(instanceType);
  if (cpus === null) return null;

  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/cloud-platform.read-only"],
  });
  const token = await auth.getAccessToken();
  if (!token.token) return null;

  const url = `https://cloudbilling.googleapis.com/v1/${COMPUTE_ENGINE_SERVICE_ID}/skus?pageSize=5000`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${token.token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as { skus?: Sku[] };
  const skus = body.skus ?? [];

  let cpuPriceHourly: number | null = null;
  let ramPriceHourly: number | null = null;

  for (const sku of skus) {
    const cat = sku.category;
    if (cat?.resourceFamily !== "Compute") continue;
    if (cat.usageType !== "OnDemand") continue;
    const desc = (sku.description ?? "").toLowerCase();
    if (!desc.includes(family.toLowerCase())) continue;
    if (!sku.serviceRegions?.includes(region)) continue;
    const price = unitPriceUsd(sku.pricingInfo?.[0]?.pricingExpression);
    if (price === null) continue;
    if (cat.resourceGroup === "CPU" && cpuPriceHourly === null) cpuPriceHourly = price;
    else if (cat.resourceGroup === "RAM" && ramPriceHourly === null) ramPriceHourly = price;
  }

  if (cpuPriceHourly === null) return null;

  // Heuristic ratio of vCPU to GB-RAM by family. Most standard families ≈ 1 vCPU : 4 GB.
  // For *-highmem, *-highcpu we'd be off; this is "good enough" until per-SKU spec exists.
  const ramGb = cpus * 4;
  const total = cpuPriceHourly * cpus + (ramPriceHourly ?? 0) * ramGb;
  if (total <= 0) return null;
  // Windows premium ~$0.04/vCPU/hr (rough public pricing). Add for Windows.
  const windowsPremium = platform === "windows" ? 0.04 * cpus : 0;
  return { usdPerHour: total + windowsPremium, source: "gcp-billing" };
}
