import "server-only";
import { db } from "@/lib/db";
import { instances, probeSamples } from "@/lib/db/schema";
import { gte, eq, and } from "drizzle-orm";
import { getInstancePrice } from "@/lib/pricing";

export interface CostRecommendation {
  instanceId: string;
  name: string;
  provider: string;
  region: string;
  current: { type: string; usdPerHour: number };
  suggested: { type: string; usdPerHour: number } | null;
  reason: string;
  monthlySavingsUsd: number;
}

/**
 * Heuristic-only cost recommendations:
 *  - Look at last 7d of probe samples for each running VM.
 *  - If avg CPU < 10% AND avg net < 100 kbps → suggest one tier down.
 *  - Tier-down rules are conservative per provider family.
 */
export async function generateCostRecommendations(limit = 50): Promise<CostRecommendation[]> {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const running = await db.select().from(instances).where(eq(instances.state, "running")).limit(limit);
  const out: CostRecommendation[] = [];

  for (const i of running) {
    const samples = await db.select().from(probeSamples)
      .where(and(eq(probeSamples.instanceId, i.id), gte(probeSamples.collectedAt, since)));
    if (samples.length < 5) continue;

    let cpuSum = 0, netSum = 0, n = 0;
    for (const s of samples) {
      try {
        const m = JSON.parse(s.metricsJson) as { cpu?: number; net_in?: number; net_out?: number };
        if (typeof m.cpu === "number") { cpuSum += m.cpu; n++; }
        if (typeof m.net_in === "number") netSum += m.net_in;
        if (typeof m.net_out === "number") netSum += m.net_out;
      } catch { /* skip */ }
    }
    if (n < 5) continue;
    const cpuAvg = cpuSum / n;
    const netAvg = netSum / n;

    if (cpuAvg > 10 || netAvg > 100) continue;

    if (!i.instanceType) continue;
    const suggestion = downgradeType(i.provider, i.instanceType);
    if (!suggestion) continue;

    const [currentPrice, suggestedPrice] = await Promise.all([
      getInstancePrice(i.provider, i.region, i.instanceType, i.platform, i.accountId),
      getInstancePrice(i.provider, i.region, suggestion, i.platform, i.accountId),
    ]);
    const cur = currentPrice?.usdPerHour ?? 0;
    const sug = suggestedPrice?.usdPerHour ?? 0;
    if (sug <= 0 || cur <= 0 || sug >= cur) continue;

    const monthlySavings = (cur - sug) * 24 * 30;
    out.push({
      instanceId: i.id,
      name: i.name ?? i.providerInstanceId,
      provider: i.provider,
      region: i.region,
      current: { type: i.instanceType ?? "unknown", usdPerHour: cur },
      suggested: { type: suggestion, usdPerHour: sug },
      reason: `7-day avg CPU ${cpuAvg.toFixed(1)}%, net ${netAvg.toFixed(0)} kbps`,
      monthlySavingsUsd: monthlySavings,
    });
  }

  return out.sort((a, b) => b.monthlySavingsUsd - a.monthlySavingsUsd);
}

/** Conservative one-tier-down mapping per provider family. Returns null if unknown. */
function downgradeType(provider: string, type: string): string | null {
  // AWS EC2: t3.large → t3.medium, m5.xlarge → m5.large, etc.
  const awsMatch = type.match(/^(t[234][ag]?|m[567][ag]?|c[567][ag]?|r[567][ag]?)\.(nano|micro|small|medium|large|xlarge|2xlarge|4xlarge)$/);
  if (provider === "aws" && awsMatch) {
    const [, family, size] = awsMatch;
    const order = ["nano", "micro", "small", "medium", "large", "xlarge", "2xlarge", "4xlarge"];
    const idx = order.indexOf(size!);
    if (idx > 0) return `${family}.${order[idx - 1]}`;
  }
  // GCP: e2-standard-4 → e2-standard-2
  const gcpMatch = type.match(/^(e2|n2|n2d|c3|c3d)-(standard|highmem|highcpu)-(\d+)$/);
  if (provider === "gcp" && gcpMatch) {
    const [, fam, kind, n] = gcpMatch;
    const next = Math.max(1, Math.floor(Number(n) / 2));
    if (next < Number(n)) return `${fam}-${kind}-${next}`;
  }
  // Azure: Standard_D2s_v5 → Standard_D1s_v5
  const azMatch = type.match(/^Standard_([A-Z]+)(\d+)([a-z]*)_(v\d+)$/);
  if (provider === "azure" && azMatch) {
    const [, fam, n, suf, ver] = azMatch;
    const next = Math.max(1, Number(n) - Math.max(1, Math.floor(Number(n) / 2)));
    if (next < Number(n)) return `Standard_${fam}${next}${suf}_${ver}`;
  }
  // DigitalOcean: s-2vcpu-4gb → s-1vcpu-2gb
  const doMatch = type.match(/^s-(\d+)vcpu-(\d+)gb$/);
  if (provider === "digitalocean" && doMatch) {
    const [, vc, gb] = doMatch;
    const nextVc = Math.max(1, Math.floor(Number(vc) / 2));
    const nextGb = Math.max(1, Math.floor(Number(gb) / 2));
    if (nextVc < Number(vc)) return `s-${nextVc}vcpu-${nextGb}gb`;
  }
  return null;
}
