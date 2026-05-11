"use server";

import "server-only";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, instances, instanceTags, snapshotHistory, tagBudgets } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { priceInstances } from "@/lib/pricing";
import { HOURS_PER_MONTH } from "@/lib/utils";

const upsertSchema = z.object({
  id: z.string().optional(),
  tagKey: z.string().min(1).max(64),
  tagValue: z.string().max(256).nullable().optional(),
  monthlyUsd: z.number().positive().max(1_000_000),
});

export interface TagBudgetEvalResult {
  id: string;
  tagKey: string;
  tagValue: string | null;
  monthlyUsd: number;
  observedUsd: number;
  exceeded: boolean;
  /**
   * Estimated days until the budget is crossed, based on a naive 7-day
   * linear trend of `snapshot_history` totals scaled to the tag share.
   * `null` when observed is flat or falling, or when there's not enough
   * history.
   */
  daysToExceed: number | null;
}

export async function listTagBudgetsAction() {
  return db.select().from(tagBudgets).orderBy(sql`monthly_usd DESC`);
}

export async function upsertTagBudgetAction(
  input: z.infer<typeof upsertSchema>,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { id, tagKey, tagValue, monthlyUsd } = parsed.data;
  if (id) {
    await db
      .update(tagBudgets)
      .set({ tagKey, tagValue: tagValue ?? null, monthlyUsd, exceeded: 0 })
      .where(eq(tagBudgets.id, id));
    revalidatePath("/costs");
    return { ok: true, id };
  }
  const newId = nanoid();
  await db.insert(tagBudgets).values({
    id: newId,
    tagKey,
    tagValue: tagValue ?? null,
    monthlyUsd,
  });
  revalidatePath("/costs");
  return { ok: true, id: newId };
}

export async function deleteTagBudgetAction(id: string): Promise<{ ok: boolean }> {
  try { await requireRole("operator"); } catch { return { ok: false }; }
  await db.delete(tagBudgets).where(eq(tagBudgets.id, id));
  revalidatePath("/costs");
  return { ok: true };
}

/**
 * Evaluate every configured tag budget against the current fleet. Returns
 * per-budget actual monthly burn and crossing state. Side effects: writes
 * lastCheckedAt + lastObservedUsd; toggles `exceeded`; audit-logs the first
 * crossing of each budget so it never spams.
 */
export async function evaluateTagBudgetsAction(): Promise<TagBudgetEvalResult[]> {
  const budgets = await db.select().from(tagBudgets);
  if (budgets.length === 0) return [];

  const allInstances = await db.select().from(instances);
  const running = allInstances.filter((i) => i.state === "running");
  const allTags = await db.select().from(instanceTags);
  const tagsByInstance = new Map<string, { key: string; value: string }[]>();
  for (const t of allTags) {
    const arr = tagsByInstance.get(t.instanceId) ?? [];
    arr.push({ key: t.key, value: t.value });
    tagsByInstance.set(t.instanceId, arr);
  }
  const priced = await priceInstances(running);
  const hourlyById = new Map<string, number>(
    Object.values(priced).map((p) => [p.id, p.usdPerHour ?? 0]),
  );

  const totalFleetHourly = running.reduce((s, r) => s + (hourlyById.get(r.id) ?? 0), 0);
  const trendSlopePerDay = await computeFleetSlopePerDay();

  const results: TagBudgetEvalResult[] = [];
  for (const b of budgets) {
    let total = 0;
    for (const inst of running) {
      const tags = tagsByInstance.get(inst.id) ?? [];
      const matches = tags.some(
        (t) => t.key === b.tagKey && (b.tagValue == null || t.value === b.tagValue),
      );
      if (matches) total += hourlyById.get(inst.id) ?? 0;
    }
    const observedUsd = total * HOURS_PER_MONTH;
    const exceeded = observedUsd > b.monthlyUsd;
    await db
      .update(tagBudgets)
      .set({
        lastCheckedAt: new Date(),
        lastObservedUsd: observedUsd,
        exceeded: exceeded ? 1 : 0,
      })
      .where(eq(tagBudgets.id, b.id));
    if (exceeded && !b.exceeded) {
      await db.insert(auditLog).values({
        action: "budget.exceeded",
        target: `${b.tagKey}${b.tagValue ? `=${b.tagValue}` : ""}`,
        status: "error",
        message: `Budget $${b.monthlyUsd.toFixed(2)} crossed — observed $${observedUsd.toFixed(2)}/mo`,
      });
    }
    results.push({
      id: b.id,
      tagKey: b.tagKey,
      tagValue: b.tagValue,
      monthlyUsd: b.monthlyUsd,
      observedUsd,
      exceeded,
      daysToExceed: estimateDaysToExceed({
        observedUsd,
        monthlyUsd: b.monthlyUsd,
        totalFleetHourly,
        tagHourly: total,
        slopePerDay: trendSlopePerDay,
      }),
    });
  }
  return results;
}

/**
 * Linear-fit hourly USD slope per day from up to the last 7 days of
 * snapshot_history. Positive slope = fleet is growing. Returns 0 when we
 * lack history or the trend is flat / falling.
 */
async function computeFleetSlopePerDay(): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = await db
    .select()
    .from(snapshotHistory)
    .where(sql`captured_at >= ${Math.floor(since.getTime() / 1000)}`);
  if (rows.length < 4) return 0;
  // Aggregate across accounts into daily totals (avg hourly USD per day).
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const r of rows) {
    const day = Math.floor(r.capturedAt.getTime() / (24 * 3600 * 1000));
    const b = buckets.get(day) ?? { sum: 0, count: 0 };
    b.sum += r.hourlyUsd;
    b.count += 1;
    buckets.set(day, b);
  }
  const points = Array.from(buckets.entries())
    .map(([day, b]) => ({ x: day, y: b.sum / b.count }))
    .sort((a, b) => a.x - b.x);
  if (points.length < 2) return 0;
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  if (den === 0) return 0;
  const slope = num / den;
  return slope > 0 ? slope : 0;
}

function estimateDaysToExceed(input: {
  observedUsd: number;
  monthlyUsd: number;
  totalFleetHourly: number;
  tagHourly: number;
  slopePerDay: number;
}): number | null {
  if (input.observedUsd >= input.monthlyUsd) return 0;
  if (input.slopePerDay <= 0 || input.totalFleetHourly <= 0) return null;
  const share = input.tagHourly / input.totalFleetHourly;
  const dailyTagGrowthUsdPerMonth = share * input.slopePerDay * HOURS_PER_MONTH;
  if (dailyTagGrowthUsdPerMonth <= 0) return null;
  const days = (input.monthlyUsd - input.observedUsd) / dailyTagGrowthUsdPerMonth;
  if (!Number.isFinite(days) || days < 0) return null;
  return Math.round(days);
}
