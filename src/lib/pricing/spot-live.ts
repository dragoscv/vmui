import "server-only";
import { db } from "@/lib/db";
import { pricingCache, cloudAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { decryptJSON } from "@/lib/crypto";
import { EC2Client, DescribeSpotPriceHistoryCommand } from "@aws-sdk/client-ec2";
import { JWT } from "google-auth-library";

/**
 * Live spot/preemptible quotes. Cached in the same pricing_cache table with
 * a synthetic key suffix ":spot" so we can serve them alongside on-demand
 * without changing the schema.
 *
 * Fall back to a heuristic fraction (see ./spot.ts) when the live API call
 * fails or no recent point exists.
 */

const TTL_MS = 6 * 60 * 60 * 1000; // 6h

interface SpotQuote {
  usdPerHour: number;
  source: string;
}

function spotKey(provider: string, region: string, instanceType: string): string {
  return `${provider}:${region}:${instanceType}:spot`;
}

async function lookupCache(key: string): Promise<SpotQuote | null> {
  const rows = await db.select().from(pricingCache).where(eq(pricingCache.id, key)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - new Date(row.fetchedAt).getTime() > TTL_MS) return null;
  return { usdPerHour: row.usdPerHour, source: row.source };
}

async function writeCache(provider: string, region: string, instanceType: string, q: SpotQuote): Promise<void> {
  const key = spotKey(provider, region, instanceType);
  await db
    .insert(pricingCache)
    .values({
      id: key,
      provider,
      region,
      instanceType,
      platform: "spot",
      usdPerHour: q.usdPerHour,
      source: q.source,
    })
    .onConflictDoUpdate({
      target: pricingCache.id,
      set: { usdPerHour: q.usdPerHour, source: q.source, fetchedAt: new Date() },
    });
}

async function loadAwsCreds(
  accountId: string,
): Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string } | null> {
  const rows = await db.select().from(cloudAccounts).where(eq(cloudAccounts.id, accountId)).limit(1);
  const row = rows[0];
  if (!row || row.provider !== "aws") return null;
  try {
    const c = decryptJSON<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }>(row.credentialsEnc);
    return c.accessKeyId && c.secretAccessKey ? c : null;
  } catch {
    return null;
  }
}

async function loadGcpCreds(
  accountId: string,
): Promise<{ client_email: string; private_key: string } | null> {
  const rows = await db.select().from(cloudAccounts).where(eq(cloudAccounts.id, accountId)).limit(1);
  const row = rows[0];
  if (!row || row.provider !== "gcp") return null;
  try {
    const c = decryptJSON<{ keyJson: { client_email: string; private_key: string } }>(row.credentialsEnc);
    return c.keyJson?.client_email && c.keyJson?.private_key
      ? { client_email: c.keyJson.client_email, private_key: c.keyJson.private_key }
      : null;
  } catch {
    return null;
  }
}

async function fetchAwsSpot(
  accountId: string,
  region: string,
  instanceType: string,
  platform: string,
): Promise<SpotQuote | null> {
  const creds = await loadAwsCreds(accountId);
  if (!creds) return null;
  const ec2 = new EC2Client({ region, credentials: creds });
  const productDescription = platform === "windows" ? "Windows" : "Linux/UNIX";
  try {
    const out = await ec2.send(
      new DescribeSpotPriceHistoryCommand({
        InstanceTypes: [instanceType as never],
        ProductDescriptions: [productDescription],
        MaxResults: 1,
        StartTime: new Date(Date.now() - 60 * 60 * 1000),
      }),
    );
    const point = out.SpotPriceHistory?.[0];
    if (!point?.SpotPrice) return null;
    const v = Number(point.SpotPrice);
    if (!Number.isFinite(v) || v <= 0) return null;
    return { usdPerHour: v, source: "aws-spot-history" };
  } catch {
    return null;
  }
}

async function fetchGcpPreemptible(
  accountId: string,
  zoneOrRegion: string,
  instanceType: string,
): Promise<SpotQuote | null> {
  const creds = await loadGcpCreds(accountId);
  if (!creds) return null;
  const region = zoneOrRegion.replace(/-[a-z]$/, "");
  const family = (instanceType.split("-")[0] ?? "").toUpperCase();
  if (!family) return null;
  const cpuMatch = /-([0-9]+)$/.exec(instanceType);
  const cpus = cpuMatch ? Number(cpuMatch[1]) : null;
  if (!cpus) return null;

  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/cloud-platform.read-only"],
  });
  const token = (await auth.getAccessToken()).token;
  if (!token) return null;
  let res: Response;
  try {
    res = await fetch(
      "https://cloudbilling.googleapis.com/v1/services/6F81-5844-456A/skus?pageSize=5000",
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  interface Sku {
    description?: string;
    category?: { resourceFamily?: string; resourceGroup?: string; usageType?: string };
    serviceRegions?: string[];
    pricingInfo?: Array<{ pricingExpression?: { tieredRates?: Array<{ unitPrice?: { units?: string; nanos?: number } }> } }>;
  }
  const body = (await res.json()) as { skus?: Sku[] };
  let cpuRate: number | null = null;
  let ramRate: number | null = null;
  for (const sku of body.skus ?? []) {
    const cat = sku.category;
    if (cat?.resourceFamily !== "Compute") continue;
    if (cat.usageType !== "Preemptible") continue;
    if (!sku.serviceRegions?.includes(region)) continue;
    if (!sku.description?.toLowerCase().includes(family.toLowerCase())) continue;
    const tier = sku.pricingInfo?.[0]?.pricingExpression?.tieredRates?.[0]?.unitPrice;
    if (!tier) continue;
    const v = Number(tier.units ?? 0) + Number(tier.nanos ?? 0) / 1e9;
    if (v <= 0) continue;
    if (cat.resourceGroup === "CPU" && cpuRate === null) cpuRate = v;
    else if (cat.resourceGroup === "RAM" && ramRate === null) ramRate = v;
  }
  if (cpuRate === null) return null;
  const ramGb = cpus * 4;
  const total = cpuRate * cpus + (ramRate ?? 0) * ramGb;
  if (total <= 0) return null;
  return { usdPerHour: total, source: "gcp-preemptible" };
}

export async function getSpotQuote(
  provider: string,
  accountId: string,
  region: string,
  instanceType: string,
  platform: string,
): Promise<SpotQuote | null> {
  const cached = await lookupCache(spotKey(provider, region, instanceType));
  if (cached) return cached;
  let q: SpotQuote | null = null;
  if (provider === "aws") q = await fetchAwsSpot(accountId, region, instanceType, platform);
  else if (provider === "gcp") q = await fetchGcpPreemptible(accountId, region, instanceType);
  if (q) await writeCache(provider, region, instanceType, q);
  // touch unused import lint
  void and;
  return q;
}
