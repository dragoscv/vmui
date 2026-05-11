import "server-only";
import type { PriceQuote } from "./types";

/**
 * Azure Retail Prices API — public, no auth required.
 * https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices
 *
 * We query the cheapest "Consumption" SKU for the (armSkuName, armRegionName)
 * pair, filtering by OS (Linux vs Windows). Returns null on miss.
 */
export async function fetchAzureRetailPrice(
  region: string,
  armSkuName: string,
  platform: string,
): Promise<PriceQuote | null> {
  const isWindows = platform === "windows";
  const filter = [
    `serviceName eq 'Virtual Machines'`,
    `priceType eq 'Consumption'`,
    `armRegionName eq '${region}'`,
    `armSkuName eq '${armSkuName}'`,
  ].join(" and ");

  const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}&$top=100`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as
    | {
        Items?: {
          retailPrice?: number;
          unitPrice?: number;
          productName?: string;
          skuName?: string;
          meterName?: string;
          unitOfMeasure?: string;
        }[];
      }
    | null;

  const items = data?.Items ?? [];
  if (items.length === 0) return null;

  const candidates = items.filter((i) => {
    const name = `${i.productName ?? ""} ${i.skuName ?? ""} ${i.meterName ?? ""}`.toLowerCase();
    if (name.includes("low priority") || name.includes("spot")) return false;
    const isWin = name.includes("windows");
    return isWindows ? isWin : !isWin;
  });

  const pool = candidates.length ? candidates : items;
  const prices = pool
    .map((i) => i.retailPrice ?? i.unitPrice ?? 0)
    .filter((p) => p > 0)
    .sort((a, b) => a - b);
  const usdPerHour = prices[0];
  if (!usdPerHour) return null;
  return { usdPerHour, source: "azure-retail" };
}
