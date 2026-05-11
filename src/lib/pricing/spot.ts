import "server-only";

/**
 * Rough spot/preemptible discount factors compared to on-demand. These are
 * intentionally conservative — actual savings are auction-based and vary by
 * region/type/time. Use only for surfacing potential savings in the UI.
 */
const SPOT_DISCOUNT: Record<string, number> = {
  aws: 0.7, // ~70% off on-demand
  azure: 0.65, // 50–90% on Spot
  gcp: 0.7, // 60–91% off on Spot/Preemptible
  scaleway: 0.0, // no spot
  "local-kvm": 0.0,
};

export function spotSavings(provider: string, hourlyUsd: number | null): {
  discountFactor: number;
  potentialMonthlySavingsUsd: number;
  spotEligible: boolean;
} {
  const factor = SPOT_DISCOUNT[provider] ?? 0;
  if (!hourlyUsd || factor === 0) {
    return { discountFactor: 0, potentialMonthlySavingsUsd: 0, spotEligible: false };
  }
  const HOURS_PER_MONTH = 730;
  return {
    discountFactor: factor,
    potentialMonthlySavingsUsd: hourlyUsd * factor * HOURS_PER_MONTH,
    spotEligible: true,
  };
}
