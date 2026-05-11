"use server";

import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { CloudWatchClient, GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";
import { db } from "@/lib/db";
import {
  auditLog,
  cloudAccounts,
  costRecommendations,
  instances,
  type InstanceRow,
} from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { requireRole } from "@/lib/auth";
import { nextSmallerAwsType } from "@/lib/pricing/static";
import { getInstancePrice } from "@/lib/pricing";
import { HOURS_PER_MONTH } from "@/lib/utils";

const LOOKBACK_DAYS = 14;
const LOOKBACK_MS = LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
const PERIOD_SEC = 3600; // 1h buckets — keeps CW datapoint count under 400.
const CPU_P95_DOWNSIZE_THRESHOLD = 20; // percent
const IDLE_P95_THRESHOLD = 3; // p95 < 3% over 14d ⇒ idle candidate

interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx] ?? null;
}

async function fetchCpuP95(
  region: string,
  instanceId: string,
  creds: AwsCreds,
): Promise<{ p95Pct: number; samples: number } | null> {
  const cw = new CloudWatchClient({
    region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    },
  });
  try {
    const out = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: "AWS/EC2",
        MetricName: "CPUUtilization",
        Dimensions: [{ Name: "InstanceId", Value: instanceId }],
        StartTime: new Date(Date.now() - LOOKBACK_MS),
        EndTime: new Date(),
        Period: PERIOD_SEC,
        Statistics: ["Average"],
        Unit: "Percent",
      }),
    );
    const values = (out.Datapoints ?? [])
      .map((d) => (typeof d.Average === "number" ? d.Average : null))
      .filter((v): v is number => v != null);
    if (values.length < 24) return null; // need at least ~1 day of data
    const v = p95(values);
    return v == null ? null : { p95Pct: v, samples: values.length };
  } catch {
    return null;
  }
}

async function analyseInstance(
  inst: InstanceRow,
  creds: AwsCreds,
): Promise<
  | null
  | {
      kind: "rightsize" | "idle";
      confidence: "low" | "medium" | "high";
      summary: string;
      suggestedInstanceType: string | null;
      observedCpuP95: number;
      lookbackHours: number;
      estMonthlySavingsUsd: number | null;
    }
> {
  if (!inst.instanceType) return null;

  const cpu = await fetchCpuP95(inst.region, inst.providerInstanceId, creds);
  if (!cpu) return null;

  const lookbackHours = (cpu.samples * PERIOD_SEC) / 3600;

  // Idle: p95 below 3% over the full window — likely candidate for stop.
  if (cpu.p95Pct < IDLE_P95_THRESHOLD) {
    const currentPrice = await getInstancePrice(
      inst.provider,
      inst.region,
      inst.instanceType,
      inst.platform,
      inst.accountId,
    );
    const monthlySavings = currentPrice?.usdPerHour
      ? currentPrice.usdPerHour * HOURS_PER_MONTH
      : null;
    return {
      kind: "idle",
      confidence: cpu.samples >= 24 * 14 ? "high" : "medium",
      summary: `p95 CPU ${cpu.p95Pct.toFixed(1)}% over ${Math.round(lookbackHours / 24)}d \u2014 candidate to stop or terminate.`,
      suggestedInstanceType: null,
      observedCpuP95: cpu.p95Pct,
      lookbackHours: Math.round(lookbackHours),
      estMonthlySavingsUsd: monthlySavings,
    };
  }

  // Rightsize: p95 under 20% but not idle — try the next-smaller type.
  if (cpu.p95Pct < CPU_P95_DOWNSIZE_THRESHOLD) {
    const suggested = nextSmallerAwsType(inst.instanceType);
    if (!suggested) return null;
    const [currentPrice, suggestedPrice] = await Promise.all([
      getInstancePrice(inst.provider, inst.region, inst.instanceType, inst.platform, inst.accountId),
      getInstancePrice(inst.provider, inst.region, suggested, inst.platform, inst.accountId),
    ]);
    if (!currentPrice?.usdPerHour || !suggestedPrice?.usdPerHour) return null;
    const diff = currentPrice.usdPerHour - suggestedPrice.usdPerHour;
    if (diff <= 0) return null;
    const monthlySavings = diff * HOURS_PER_MONTH;
    return {
      kind: "rightsize",
      confidence: cpu.samples >= 24 * 14 ? "high" : "medium",
      summary: `p95 CPU ${cpu.p95Pct.toFixed(1)}% \u2014 try ${suggested} (saves ~$${monthlySavings.toFixed(2)}/mo).`,
      suggestedInstanceType: suggested,
      observedCpuP95: cpu.p95Pct,
      lookbackHours: Math.round(lookbackHours),
      estMonthlySavingsUsd: monthlySavings,
    };
  }

  return null;
}

/**
 * Recompute cost recommendations across all AWS instances (or a single
 * account when `accountId` is provided). Existing rows for processed
 * instances are replaced. Untouched instances keep their previous rows
 * until the next sync removes them on cascade.
 */
export async function recomputeCostRecommendationsAction(
  input: { accountId?: string } = {},
): Promise<{ ok: true; count: number; analysed: number } | { ok: false; error: string }> {
  await requireRole("operator");

  const accountRows = input.accountId
    ? await db.select().from(cloudAccounts).where(eq(cloudAccounts.id, input.accountId)).limit(1)
    : await db.select().from(cloudAccounts);
  const awsAccounts = accountRows.filter((a) => a.provider === "aws");
  if (awsAccounts.length === 0) {
    return { ok: false, error: "No AWS accounts connected." };
  }

  let total = 0;
  let analysed = 0;

  for (const account of awsAccounts) {
    let creds: AwsCreds;
    try {
      creds = decryptJSON<AwsCreds>(account.credentialsEnc);
    } catch {
      continue;
    }
    if (!creds.accessKeyId || !creds.secretAccessKey) continue;

    const instanceRows = await db
      .select()
      .from(instances)
      .where(eq(instances.accountId, account.id));
    const running = instanceRows.filter((i) => i.state === "running");
    analysed += running.length;

    const results = await Promise.all(
      running.map(async (inst) => ({ inst, rec: await analyseInstance(inst, creds) })),
    );

    const newRows = results
      .filter((r): r is { inst: InstanceRow; rec: NonNullable<Awaited<ReturnType<typeof analyseInstance>>> } => r.rec !== null)
      .map(({ inst, rec }) => ({
        id: nanoid(),
        accountId: account.id,
        instanceId: inst.id,
        kind: rec.kind,
        confidence: rec.confidence,
        summary: rec.summary,
        suggestedInstanceType: rec.suggestedInstanceType,
        observedCpuP95: rec.observedCpuP95,
        lookbackHours: rec.lookbackHours,
        estMonthlySavingsUsd: rec.estMonthlySavingsUsd,
        detailsJson: null,
        computedAt: new Date(),
      }));

    // Replace previous recommendations for the instances we analysed.
    const analysedIds = running.map((i) => i.id);
    if (analysedIds.length > 0) {
      await db.delete(costRecommendations).where(inArray(costRecommendations.instanceId, analysedIds));
    }
    if (newRows.length > 0) {
      await db.insert(costRecommendations).values(newRows);
    }

    total += newRows.length;

    await db.insert(auditLog).values({
      accountId: account.id,
      action: "cost-recommendations.recompute",
      target: account.id,
      status: "ok",
      message: `Analysed ${running.length} instances, surfaced ${newRows.length} recommendation${newRows.length === 1 ? "" : "s"}.`,
    });
  }

  revalidatePath("/costs/recommendations");
  return { ok: true, count: total, analysed };
}
