import "server-only";
import type { PriceQuote } from "./types";

/**
 * Scaleway Apple Silicon (Mac mini) products endpoint:
 *   GET https://api.scaleway.com/apple-silicon/v1alpha1/zones/{zone}/server-types
 * Returns hourly_price as `{ value: float, currency_code: "EUR"|"USD" }`.
 *
 * For now we return EUR figures cast to USD 1:1 as a rough approximation —
 * Scaleway publishes EUR prices and most regions don't have USD listings.
 * If currency_code is USD we use it directly.
 */
interface ServerTypeStock {
  name: string;
  hourly_price?: { value?: number; currency_code?: string } | number;
}
interface ServerTypesResponse {
  server_types?: ServerTypeStock[];
}

export async function fetchScalewayPrice(
  creds: { secretKey: string },
  zone: string,
  instanceType: string,
): Promise<PriceQuote | null> {
  const url = `https://api.scaleway.com/apple-silicon/v1alpha1/zones/${zone}/server-types`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-Auth-Token": creds.secretKey },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as ServerTypesResponse;
  const match = (body.server_types ?? []).find((t) => t.name?.toLowerCase() === instanceType.toLowerCase());
  if (!match) return null;
  const raw = match.hourly_price;
  let value: number | null = null;
  if (typeof raw === "number") value = raw;
  else if (typeof raw === "object" && raw && typeof raw.value === "number") value = raw.value;
  if (value === null || value <= 0) return null;
  return { usdPerHour: value, source: "scaleway-catalog" };
}
