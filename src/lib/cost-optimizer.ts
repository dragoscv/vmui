import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { instances, probeSamples, pricingCache, type InstanceRow } from "@/lib/db/schema";

export type RecommendationKind = "idle" | "rightsize-down" | "stop-and-snapshot" | "reserved-instance";

export interface CostRecommendation {
  instanceId: string;
  instanceName: string;
  provider: string;
  region: string;
  instanceType: string;
  kind: RecommendationKind;
  /** Estimated monthly savings in USD. */
  monthlyUsd: number;
  /** Human-readable rationale. */
  reason: string;
  /** Concrete suggested action label. */
  suggestion: string;
}

interface MetricStats {
  count: number;
  cpuAvg: number;
  cpuP95: number;
  netInAvg: number;
  netOutAvg: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function statsFor(instanceId: string, windowDays: number): Promise<MetricStats | null> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60_000);
  const rows = await db
    .select()
    .from(probeSamples)
    .where(and(eq(probeSamples.instanceId, instanceId), gte(probeSamples.collectedAt, cutoff)))
    .orderBy(desc(probeSamples.collectedAt))
    .limit(2000);
  if (rows.length < 12) return null; // need at least some history
  const cpus: number[] = [];
  let netIn = 0;
  let netOut = 0;
  for (const r of rows) {
    try {
      const m = JSON.parse(r.metricsJson) as { cpu?: number; net_in?: number; net_out?: number };
      if (typeof m.cpu === "number") cpus.push(m.cpu);
      if (typeof m.net_in === "number") netIn += m.net_in;
      if (typeof m.net_out === "number") netOut += m.net_out;
    } catch {
      /* ignore */
    }
  }
  if (cpus.length === 0) return null;
  const sorted = [...cpus].sort((a, b) => a - b);
  const avg = cpus.reduce((a, b) => a + b, 0) / cpus.length;
  return {
    count: cpus.length,
    cpuAvg: avg,
    cpuP95: percentile(sorted, 95),
    netInAvg: netIn / cpus.length,
    netOutAvg: netOut / cpus.length,
  };
}

async function hourlyUsd(provider: string, instanceType: string, region: string): Promise<number | null> {
  const row = db
    .select()
    .from(pricingCache)
    .where(
      and(
        eq(pricingCache.provider, provider),
        eq(pricingCache.instanceType, instanceType),
        eq(pricingCache.region, region),
      ),
    )
    .get();
  return row?.usdPerHour ?? null;
}

function smallerTypeOf(instanceType: string): string | null {
  // Heuristic: drop the size suffix one notch (m5.large -> m5.medium etc.).
  const map: Record<string, string> = {
    "2xlarge": "xlarge",
    xlarge: "large",
    large: "medium",
    medium: "small",
    small: "micro",
  };
  for (const [from, to] of Object.entries(map)) {
    if (instanceType.endsWith(from)) {
      return instanceType.slice(0, -from.length) + to;
    }
  }
  return null;
}

async function recommendForInstance(inst: InstanceRow): Promise<CostRecommendation[]> {
  if (inst.state !== "running") return [];
  const stats = await statsFor(inst.id, 7);
  if (!stats) return [];
  const price = await hourlyUsd(inst.provider, inst.instanceType ?? "", inst.region);
  if (!price) return [];
  const monthly = price * 24 * 30;

  const out: CostRecommendation[] = [];
  const name = inst.name ?? inst.providerInstanceId;

  if (stats.cpuP95 < 5 && stats.netInAvg + stats.netOutAvg < 1000) {
    out.push({
      instanceId: inst.id,
      instanceName: name,
      provider: inst.provider,
      region: inst.region,
      instanceType: inst.instanceType ?? "",
      kind: "idle",
      monthlyUsd: monthly,
      reason: `CPU p95 ${stats.cpuP95.toFixed(1)}% over 7d, near-zero network. Looks idle.`,
      suggestion: "Stop & snapshot. Resume on demand.",
    });
  } else if (stats.cpuP95 < 25) {
    const smaller = smallerTypeOf(inst.instanceType ?? "");
    if (smaller) {
      const smallerPrice = (await hourlyUsd(inst.provider, smaller, inst.region)) ?? price * 0.5;
      const saveMonthly = (price - smallerPrice) * 24 * 30;
      if (saveMonthly > 0) {
        out.push({
          instanceId: inst.id,
          instanceName: name,
          provider: inst.provider,
          region: inst.region,
          instanceType: inst.instanceType ?? "",
          kind: "rightsize-down",
          monthlyUsd: saveMonthly,
          reason: `CPU p95 only ${stats.cpuP95.toFixed(1)}%. ${smaller} would have headroom.`,
          suggestion: `Resize to ${smaller}.`,
        });
      }
    }
  }

  // RI suggestion: any always-on instance saves ~30% with a 1y RI
  out.push({
    instanceId: inst.id,
    instanceName: name,
    provider: inst.provider,
    region: inst.region,
    instanceType: inst.instanceType ?? "",
    kind: "reserved-instance",
    monthlyUsd: monthly * 0.3,
    reason: `On-demand cost ~$${monthly.toFixed(0)}/mo. 1-year RI typically saves ~30%.`,
    suggestion: "Purchase 1-year reserved instance / savings plan.",
  });

  return out;
}

/**
 * Generate cost recommendations for every running instance, sorted by
 * estimated monthly savings (highest first).
 */
export async function generateCostRecommendations(): Promise<CostRecommendation[]> {
  const rows = await db.select().from(instances);
  const all: CostRecommendation[] = [];
  for (const inst of rows) {
    all.push(...(await recommendForInstance(inst)));
  }
  return all.sort((a, b) => b.monthlyUsd - a.monthlyUsd);
}
