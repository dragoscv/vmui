import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pricingCache, cloudAccounts } from "@/lib/db/schema";
import { lookupStaticPrice } from "./static";
import { fetchAzureRetailPrice } from "./azure-retail";
import { fetchAwsPrice } from "./aws-pricing";
import { fetchGcpPrice } from "./gcp-billing";
import { fetchScalewayPrice } from "./scaleway-pricing";
import { decryptJSON } from "@/lib/crypto";
import type { PriceQuote } from "./types";

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Resolve an hourly USD price for one VM. Order of precedence:
 *   1. SQLite pricing_cache row younger than TTL.
 *   2. Curated static table (instant, never fails for popular types).
 *   3. (future) live provider pricing services — overlaid here.
 *
 * Always cheap enough to call inline from RSC. Returns null when nothing
 * is known so the UI can show "—".
 */
export async function getInstancePrice(
  provider: string,
  region: string,
  instanceType: string | null,
  platform: string,
  accountId?: string,
): Promise<PriceQuote | null> {
  if (!instanceType) return null;
  const id = `${provider}:${region}:${instanceType}:${platform}`;
  const cached = await db
    .select()
    .from(pricingCache)
    .where(eq(pricingCache.id, id))
    .limit(1);
  const hit = cached[0];
  if (hit && Date.now() - hit.fetchedAt.getTime() < TTL_MS) {
    return {
      usdPerHour: hit.usdPerHour,
      source: hit.source as PriceQuote["source"],
      fetchedAt: hit.fetchedAt,
    };
  }

  const stat = lookupStaticPrice(provider, region, instanceType, platform);
  let resolved: PriceQuote | null = stat;
  if (provider === "azure") {
    const live = await fetchAzureRetailPrice(region, instanceType, platform);
    if (live) resolved = live;
  } else if (provider === "aws" && accountId) {
    const creds = await loadAwsCredentials(accountId);
    if (creds) {
      const live = await fetchAwsPrice(creds, region, instanceType, platform);
      if (live) resolved = live;
    }
  } else if (provider === "gcp" && accountId) {
    const creds = await loadGcpCredentials(accountId);
    if (creds) {
      const live = await fetchGcpPrice(creds, region, instanceType, platform);
      if (live) resolved = live;
    }
  } else if (provider === "scaleway" && accountId) {
    const creds = await loadScalewayCredentials(accountId);
    if (creds) {
      const live = await fetchScalewayPrice(creds, region, instanceType);
      if (live) resolved = live;
    }
  }
  if (resolved) {
    const fetchedAt = new Date();
    // best-effort cache write; ignore conflicts
    try {
      await db
        .insert(pricingCache)
        .values({
          id,
          provider,
          region,
          instanceType,
          platform,
          usdPerHour: resolved.usdPerHour,
          source: resolved.source,
          fetchedAt,
        })
        .onConflictDoUpdate({
          target: pricingCache.id,
          set: {
            usdPerHour: resolved.usdPerHour,
            source: resolved.source,
            fetchedAt,
          },
        });
    } catch {
      /* non-fatal */
    }
    return { ...resolved, fetchedAt };
  }
  return null;
}

export interface PricedRow {
  id: string;
  usdPerHour: number | null;
  source: PriceQuote["source"] | null;
  fetchedAt: Date | null;
}

/**
 * Bulk variant — used for the dashboard burn estimate. Returns one row per
 * instance, with null price for instances we don't recognise.
 */
export async function priceInstances(
  rows: { id: string; provider: string; region: string; instanceType: string | null; platform: string; accountId?: string }[],
): Promise<Record<string, PricedRow>> {
  const out: Record<string, PricedRow> = {};
  await Promise.all(
    rows.map(async (r) => {
      const q = await getInstancePrice(r.provider, r.region, r.instanceType, r.platform, r.accountId);
      out[r.id] = {
        id: r.id,
        usdPerHour: q?.usdPerHour ?? null,
        source: q?.source ?? null,
        fetchedAt: q?.fetchedAt ?? null,
      };
    }),
  );
  return out;
}

/**
 * Decrypt the AWS credentials blob for a single account. Returns null when
 * the account is not AWS, missing, or fails to decrypt.
 */
async function loadAwsCredentials(
  accountId: string,
): Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string } | null> {
  const rows = await db
    .select()
    .from(cloudAccounts)
    .where(eq(cloudAccounts.id, accountId))
    .limit(1);
  const row = rows[0];
  if (!row || row.provider !== "aws") return null;
  try {
    const c = decryptJSON<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }>(
      row.credentialsEnc,
    );
    if (!c.accessKeyId || !c.secretAccessKey) return null;
    return c;
  } catch {
    return null;
  }
}

async function loadScalewayCredentials(
  accountId: string,
): Promise<{ secretKey: string } | null> {
  const rows = await db
    .select()
    .from(cloudAccounts)
    .where(eq(cloudAccounts.id, accountId))
    .limit(1);
  const row = rows[0];
  if (!row || row.provider !== "scaleway") return null;
  try {
    const c = decryptJSON<{ secretKey: string }>(row.credentialsEnc);
    if (!c.secretKey) return null;
    return { secretKey: c.secretKey };
  } catch {
    return null;
  }
}

async function loadGcpCredentials(
  accountId: string,
): Promise<{ client_email: string; private_key: string } | null> {
  const rows = await db
    .select()
    .from(cloudAccounts)
    .where(eq(cloudAccounts.id, accountId))
    .limit(1);
  const row = rows[0];
  if (!row || row.provider !== "gcp") return null;
  try {
    const c = decryptJSON<{ keyJson: { client_email: string; private_key: string } }>(
      row.credentialsEnc,
    );
    const k = c.keyJson;
    if (!k?.client_email || !k?.private_key) return null;
    return { client_email: k.client_email, private_key: k.private_key };
  } catch {
    return null;
  }
}
