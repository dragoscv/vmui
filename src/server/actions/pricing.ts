"use server";

import { getInstancePrice } from "@/lib/pricing";

export async function quoteInstancePriceAction(input: {
  accountId: string;
  provider: string;
  region: string;
  instanceType: string;
  platform: string;
}): Promise<
  | { ok: true; usdPerHour: number; source: string }
  | { ok: false; error: string }
> {
  if (!input.region || !input.instanceType) {
    return { ok: false, error: "Pick a region and instance type." };
  }
  try {
    const q = await getInstancePrice(
      input.provider,
      input.region,
      input.instanceType,
      input.platform,
      input.accountId,
    );
    if (!q) return { ok: false, error: "No pricing available for this combination yet." };
    return { ok: true, usdPerHour: q.usdPerHour, source: q.source };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
