import "server-only";
import { db } from "@/lib/db";
import { schedules, instances, auditLog, cloudAccounts } from "@/lib/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { matchesNow } from "@/lib/cron";
import { getProvider } from "@/lib/providers/registry";
import { applySnapshotRetentionAction } from "@/server/actions/snapshot-retention";
import { maybeRunIdlePark } from "@/lib/idle-park";
import { captureFleetSnapshot } from "@/lib/fleet-diff";
import { maybeAlertBurnRate } from "@/lib/burn-rate";
import { checkAccountBudgets } from "@/server/actions/templates-and-budgets";
import { maybeRunIdleAutoStop, maybeRecomputeBaselines, maybeCheckDrift } from "@/lib/idle-and-drift";
import { notify } from "@/lib/notifications";
import { redactSecrets } from "@/lib/redact";

declare global {
  // eslint-disable-next-line no-var
  var __vmuiScheduler__: { interval: ReturnType<typeof setInterval> } | undefined;
  // eslint-disable-next-line no-var
  var __vmuiLastRetentionRun__: number | undefined;
}

const TICK_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function maybeRunRetention(): Promise<void> {
  const last = globalThis.__vmuiLastRetentionRun__ ?? 0;
  if (Date.now() - last < DAY_MS) return;
  globalThis.__vmuiLastRetentionRun__ = Date.now();
  const accs = await db
    .select()
    .from(cloudAccounts)
    .where(isNotNull(cloudAccounts.snapshotRetentionCount));
  for (const a of accs) {
    try {
      await applySnapshotRetentionAction(a.id);
    } catch (err) {
      await db.insert(auditLog).values({
        accountId: a.id,
        action: "snapshot.retention.run",
        status: "error",
        message: err instanceof Error ? err.message : "retention sweep failed",
      });
    }
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  const rows = await db.select().from(schedules);
  for (const row of rows) {
    if (!row.enabled) continue;
    if (!matchesNow(row.cron, now)) continue;
    if (row.lastRunAt && now.getTime() - row.lastRunAt.getTime() < 55_000) continue;

    const inst = (await db.select().from(instances).where(eq(instances.id, row.instanceId)).limit(1))[0];
    if (!inst) continue;

    let status: "ok" | "error" = "ok";
    let message: string | undefined;
    try {
      const { provider } = await getProvider(row.accountId);
      if (row.action === "start") await provider.startInstance(inst.region, inst.providerInstanceId);
      else if (row.action === "stop") await provider.stopInstance(inst.region, inst.providerInstanceId);
      else if (row.action === "reboot") await provider.rebootInstance(inst.region, inst.providerInstanceId);
      else if (row.action === "snapshot") {
        if (!provider.createSnapshot) throw new Error("Provider does not support snapshots");
        const label = `scheduled-${now.toISOString().replace(/[:.]/g, "-")}`;
        await provider.createSnapshot(inst.region, inst.providerInstanceId, label);
      }
    } catch (err) {
      status = "error";
      message = err instanceof Error ? err.message : "scheduled action failed";
    }
    await db
      .update(schedules)
      .set({ lastRunAt: now, lastRunStatus: status })
      .where(eq(schedules.id, row.id));
    await db.insert(auditLog).values({
      accountId: row.accountId,
      action: `schedule.${row.action}`,
      target: inst.providerInstanceId,
      status,
      message: message ?? `cron "${row.cron}"`,
    });
    if (status === "error") {
      await notify({
        category: "schedule",
        severity: "error",
        title: `Schedule failed: ${row.action} ${inst.name ?? inst.providerInstanceId}`,
        body: redactSecrets(message ?? `cron "${row.cron}"`),
        href: `/instances/${encodeURIComponent(inst.id)}`,
        accountId: row.accountId,
      });
    }
  }
  // touch unused import lint
  void and;
  await maybeRunRetention();
  await maybeRunIdlePark();
  await maybeRunFleetSnapshot();
  await maybeAlertBurnRate().catch(() => undefined);
  await checkAccountBudgets().catch(() => undefined);
  await maybeRunIdleAutoStop().catch(() => undefined);
  await maybeRecomputeBaselines().catch(() => undefined);
  await maybeCheckDrift().catch(() => undefined);
}

let lastFleetSnapAt = 0;
async function maybeRunFleetSnapshot(): Promise<void> {
  // capture once per ~24h
  if (Date.now() - lastFleetSnapAt < 23 * 3600_000) return;
  try {
    await captureFleetSnapshot();
    lastFleetSnapAt = Date.now();
  } catch {
    /* swallowed */
  }
}

export function ensureSchedulerRunning(): void {
  if (typeof window !== "undefined") return;
  if (globalThis.__vmuiScheduler__) return;
  const interval = setInterval(() => {
    tick().catch((err) => {
      console.error("[vmui] scheduler tick failed", err);
    });
  }, TICK_MS);
  // Allow node to exit even if the interval is still alive (e.g. Next.js dev hot-reload)
  if (typeof interval.unref === "function") interval.unref();
  globalThis.__vmuiScheduler__ = { interval };
}
