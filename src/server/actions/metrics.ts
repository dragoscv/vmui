"use server";

import { db } from "@/lib/db";
import { auditLog, instances } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers/registry";
import type {
  InstanceLogChunk,
  MetricsHistory,
} from "@/lib/providers/types";
import { and, eq } from "drizzle-orm";

async function resolveInstance(accountId: string, providerInstanceId?: string) {
  const where = providerInstanceId
    ? and(eq(instances.accountId, accountId), eq(instances.providerInstanceId, providerInstanceId))
    : eq(instances.accountId, accountId);
  const rows = await db.select().from(instances).where(where).limit(1);
  return rows[0] ?? null;
}

export async function getMetricsHistoryAction(
  accountId: string,
  providerInstanceId: string,
  rangeMinutes: number,
): Promise<
  | { ok: true; data: MetricsHistory }
  | { ok: false; error: string }
> {
  const range = Math.min(Math.max(15, rangeMinutes), 60 * 24 * 7);
  try {
    const inst = await resolveInstance(accountId, providerInstanceId);
    if (!inst) return { ok: false, error: "Instance not found" };
    const { provider } = await getProvider(accountId);
    if (typeof provider.getMetricsHistory !== "function") {
      return {
        ok: false,
        error: `Metrics history is not supported for the ${provider.id} provider yet.`,
      };
    }
    const data = await provider.getMetricsHistory(inst.region, inst.providerInstanceId, range);
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    return { ok: false, error: msg };
  }
}

export async function getInstanceLogsAction(
  accountId: string,
  providerInstanceId: string,
): Promise<
  | { ok: true; data: InstanceLogChunk }
  | { ok: false; error: string }
> {
  try {
    const inst = await resolveInstance(accountId, providerInstanceId);
    if (!inst) return { ok: false, error: "Instance not found" };
    const { provider } = await getProvider(accountId);
    if (typeof provider.getInstanceLogs !== "function") {
      return {
        ok: false,
        error: `Console logs are not supported for the ${provider.id} provider yet.`,
      };
    }
    const data = await provider.getInstanceLogs(inst.region, inst.providerInstanceId);
    await db.insert(auditLog).values({
      accountId,
      action: "instance.logs",
      target: inst.providerInstanceId,
      status: "ok",
      message: `${data.text.length} bytes`,
    });
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    await db.insert(auditLog).values({
      accountId,
      action: "instance.logs",
      target: providerInstanceId,
      status: "error",
      message: msg,
    });
    return { ok: false, error: msg };
  }
}
