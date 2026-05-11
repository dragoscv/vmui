import "server-only";
import { db } from "@/lib/db";
import { instances, instanceTags, probeSamples, probeBaselines, auditLog } from "@/lib/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import { notify } from "@/lib/notifications";
import { getProvider } from "@/lib/providers/registry";

/* -------- Idle-VM auto-stop --------
 * Stop instances that:
 *   - Are running
 *   - CPU < 5% mean for last 24h (>= 24 samples to qualify)
 *   - Don't have local tag "vmui:noidlestop=true"
 */
const IDLE_TAG = "vmui:noidlestop";

export async function runIdleAutoStop(): Promise<{ stopped: string[]; skipped: number }> {
  const stopped: string[] = [];
  let skipped = 0;
  const since = new Date(Date.now() - 24 * 3600_000);

  const running = await db.select().from(instances).where(eq(instances.state, "running"));
  for (const inst of running) {
    const tags = await db.select().from(instanceTags).where(eq(instanceTags.instanceId, inst.id));
    if (tags.find((t) => t.key === IDLE_TAG && (t.value === "true" || t.value === "1"))) { skipped++; continue; }

    const samples = await db.select().from(probeSamples)
      .where(and(eq(probeSamples.instanceId, inst.id), gte(probeSamples.collectedAt, since)));
    if (samples.length < 24) continue;

    let cpuSum = 0, n = 0;
    for (const s of samples) {
      try {
        const m = JSON.parse(s.metricsJson) as { cpu?: number };
        if (typeof m.cpu === "number") { cpuSum += m.cpu; n++; }
      } catch { /* skip */ }
    }
    if (n < 24) continue;
    const mean = cpuSum / n;
    if (mean >= 5) continue;

    try {
      const { provider } = await getProvider(inst.accountId);
      await provider.stopInstance(inst.region, inst.providerInstanceId);
      await db.insert(auditLog).values({
        accountId: inst.accountId, action: "idle.auto-stop", target: inst.providerInstanceId,
        status: "ok", message: `cpu mean ${mean.toFixed(1)}% over 24h`,
      });
      await notify({
        category: "instance", severity: "info",
        title: `Idle auto-stopped: ${inst.name ?? inst.providerInstanceId}`,
        body: `CPU averaged ${mean.toFixed(1)}% over 24h. Tag with ${IDLE_TAG}=true to opt out.`,
        href: `/instances/${encodeURIComponent(inst.id)}`,
        accountId: inst.accountId,
      });
      stopped.push(inst.id);
    } catch (e) {
      await db.insert(auditLog).values({
        accountId: inst.accountId, action: "idle.auto-stop", target: inst.providerInstanceId,
        status: "error", message: e instanceof Error ? e.message : "stop failed",
      });
    }
  }
  return { stopped, skipped };
}

let _lastIdleRun = 0;
export async function maybeRunIdleAutoStop() {
  const now = Date.now();
  if (now - _lastIdleRun < 6 * 3600_000) return;
  _lastIdleRun = now;
  await runIdleAutoStop().catch(() => undefined);
}

/* -------- Drift alarm --------
 * Recompute baseline from last 7d every 24h. Compare last 1h mean to baseline;
 * if |observed - mean| > 2*std, alert.
 */
function meanStd(xs: number[]): { mean: number; std: number } {
  if (xs.length === 0) return { mean: 0, std: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean, std: Math.sqrt(variance) };
}

let _lastBaselineCompute = 0;
let _lastDriftCheck = 0;
const _alerted = new Map<string, number>();

export async function maybeRecomputeBaselines() {
  const now = Date.now();
  if (now - _lastBaselineCompute < 24 * 3600_000) return;
  _lastBaselineCompute = now;
  const since = new Date(now - 7 * 24 * 3600_000);
  const all = await db.select().from(instances);
  for (const inst of all) {
    const samples = await db.select().from(probeSamples)
      .where(and(eq(probeSamples.instanceId, inst.id), gte(probeSamples.collectedAt, since)));
    if (samples.length < 100) continue;
    const cpus: number[] = [], mems: number[] = [];
    for (const s of samples) {
      try {
        const m = JSON.parse(s.metricsJson) as { cpu?: number; mem?: number };
        if (typeof m.cpu === "number") cpus.push(m.cpu);
        if (typeof m.mem === "number") mems.push(m.mem);
      } catch { /* skip */ }
    }
    const c = meanStd(cpus); const me = meanStd(mems);
    const existing = await db.select().from(probeBaselines).where(eq(probeBaselines.instanceId, inst.id)).limit(1);
    if (existing[0]) {
      await db.update(probeBaselines).set({
        cpuMean: c.mean, cpuStd: c.std, memMean: me.mean, memStd: me.std,
        samples: samples.length, computedAt: new Date(),
      }).where(eq(probeBaselines.instanceId, inst.id));
    } else {
      await db.insert(probeBaselines).values({
        instanceId: inst.id, cpuMean: c.mean, cpuStd: c.std, memMean: me.mean, memStd: me.std, samples: samples.length,
      });
    }
  }
}

export async function maybeCheckDrift() {
  const now = Date.now();
  if (now - _lastDriftCheck < 30 * 60_000) return;
  _lastDriftCheck = now;
  const since = new Date(now - 60 * 60_000);
  const baselines = await db.select().from(probeBaselines);
  for (const b of baselines) {
    const last = _alerted.get(b.instanceId) ?? 0;
    if (now - last < 6 * 3600_000) continue;
    if (b.cpuStd < 1) continue;
    const samples = await db.select().from(probeSamples)
      .where(and(eq(probeSamples.instanceId, b.instanceId), gte(probeSamples.collectedAt, since)));
    if (samples.length < 6) continue;
    const cpus: number[] = [];
    for (const s of samples) {
      try { const m = JSON.parse(s.metricsJson) as { cpu?: number }; if (typeof m.cpu === "number") cpus.push(m.cpu); } catch { /* skip */ }
    }
    if (cpus.length === 0) continue;
    const obs = cpus.reduce((a, x) => a + x, 0) / cpus.length;
    const z = Math.abs(obs - b.cpuMean) / b.cpuStd;
    if (z < 2) continue;
    _alerted.set(b.instanceId, now);
    const inst = await db.select().from(instances).where(eq(instances.id, b.instanceId)).limit(1);
    if (!inst[0]) continue;
    await notify({
      category: "instance", severity: "warning",
      title: `CPU drift: ${inst[0].name ?? inst[0].providerInstanceId}`,
      body: `Last hour ${obs.toFixed(1)}% vs 7d baseline ${b.cpuMean.toFixed(1)}±${b.cpuStd.toFixed(1)}% (z=${z.toFixed(1)})`,
      href: `/instances/${encodeURIComponent(b.instanceId)}`,
      accountId: inst[0].accountId,
    });
    await db.insert(auditLog).values({
      accountId: inst[0].accountId, action: "drift.detected", target: inst[0].providerInstanceId,
      status: "ok", message: `cpu obs=${obs.toFixed(1)} base=${b.cpuMean.toFixed(1)} std=${b.cpuStd.toFixed(1)} z=${z.toFixed(1)}`,
    });
  }
}

void desc;
