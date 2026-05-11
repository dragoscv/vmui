import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { costRecommendations, instances, type CostRecommendationRow } from "@/lib/db/schema";

export interface CostRecommendation extends CostRecommendationRow {
  instanceName: string | null;
  instanceType: string | null;
  provider: string;
  region: string;
}

export async function listCostRecommendations(): Promise<CostRecommendation[]> {
  const rows = await db
    .select({ rec: costRecommendations, instance: instances })
    .from(costRecommendations)
    .leftJoin(instances, eq(costRecommendations.instanceId, instances.id))
    .orderBy(desc(costRecommendations.estMonthlySavingsUsd));
  return rows.map((r) => ({
    ...r.rec,
    instanceName: r.instance?.displayName ?? r.instance?.name ?? null,
    instanceType: r.instance?.instanceType ?? null,
    provider: r.instance?.provider ?? "unknown",
    region: r.instance?.region ?? "",
  }));
}

export async function totalProjectedMonthlySavings(): Promise<number> {
  const rows = await db
    .select({ s: costRecommendations.estMonthlySavingsUsd })
    .from(costRecommendations);
  return rows.reduce((sum, r) => sum + (r.s ?? 0), 0);
}
