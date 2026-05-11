import "server-only";

export type PriceSource = "static" | "aws-pricing-api" | "scaleway-catalog" | "azure-retail" | "gcp-billing" | "kvm-free";

export interface PriceQuote {
  usdPerHour: number;
  source: PriceSource;
  /** Set when the quote came from the cache or after a fresh write. */
  fetchedAt?: Date;
}

export interface PricingProvider {
  id: string;
  /**
   * Look up an on-demand hourly USD price for one (region, instanceType, platform)
   * combination. Return null when no price is known. Implementations should be
   * tolerant of unknown types — the caller falls back to a curated table.
   */
  getPrice(region: string, instanceType: string, platform: string): Promise<PriceQuote | null>;
}
