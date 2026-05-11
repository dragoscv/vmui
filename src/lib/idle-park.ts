import "server-only";
import { db } from "@/lib/db";
import { idleParkPolicies, instances, probeSamples, auditLog } from "@/lib/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import { getProvider } from "@/lib/providers/registry";
import { notify } from "@/lib/notifications";

const DAY_MS = 24 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __vmuiLastIdleParkRun__: number | undefined;
}

/**
 * Idle VM auto-park sweep. Runs at most once per scheduler tick window
 * (5 min cool-down). For each enabled policy:
 *   1. read the latest probe samples within the policy window
 *   2. if every sample shows CPU < cpuPct AND net < netKbps, stop the VM
 *   3. audit + notify; update lastParkedAt
 */
export async function maybeRunIdlePark(): Promise<void> {
  const last = globalThis.__vmuiLastIdleParkRun__ ?? 0;
  if (Date.now() - last < 5 * 60 * 1000) return;
  globalThis.__vmuiLastIdleParkRun__ = Date.now();

  const policies = await db.select().from(idleParkPolicies).where(eq(idleParkPolicies.enabled, 1));
  for (const p of policies) {
    try {
      if (p.lastParkedAt && Date.now() - p.lastParkedAt.getTime() < DAY_MS) continue;
      const inst = (
        await db
          .select()
          .from(instances)
          .where(and(eq(instances.accountId, p.accountId), eq(instances.providerInstanceId, p.providerInstanceId)))
          .limit(1)
      )[0];
      if (!inst || inst.state !== "running") continue;

      const since = new Date(Date.now() - p.windowMin * 60 * 1000);
      const samples = await db
        .select()
        .from(probeSamples)
        .where(and(eq(probeSamples.instanceId, inst.id), gte(probeSamples.collectedAt, since)))
        .orderBy(desc(probeSamples.collectedAt))
        .limit(6);
      if (samples.length < 3) continue;
      const parsed = samples.map((s) => {
        try {
          return JSON.parse(s.metricsJson) as { cpu?: number; net_in?: number; net_out?: number };
        } catch { return {}; }
      });
      const allIdle = parsed.every(
        (m) =>
          (m.cpu ?? 100) < p.cpuPct &&
          ((m.net_in ?? Infinity) / 1024) < p.netKbps &&
          ((m.net_out ?? Infinity) / 1024) < p.netKbps,
      );
      if (!allIdle) continue;

      const { provider } = await getProvider(p.accountId);
      await provider.stopInstance(inst.region, inst.providerInstanceId);
      await db.update(idleParkPolicies).set({ lastParkedAt: new Date() }).where(eq(idleParkPolicies.id, p.id));
      await db.insert(auditLog).values({
        accountId: p.accountId,
        action: "idle.park",
        target: p.providerInstanceId,
        status: "ok",
        message: `Auto-parked idle VM (≤${p.cpuPct}% CPU for ${p.windowMin}m)`,
      });
      await notify({
        category: "instance",
        severity: "info",
        title: `Auto-parked ${inst.name ?? inst.providerInstanceId}`,
        body: `Idle for ${p.windowMin} minutes (<${p.cpuPct}% CPU).`,
      });
    } catch (err) {
      await db.insert(auditLog).values({
        accountId: p.accountId,
        action: "idle.park",
        target: p.providerInstanceId,
        status: "error",
        message: err instanceof Error ? err.message.slice(0, 200) : "idle-park failed",
      });
    }
  }
}
