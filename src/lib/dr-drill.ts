import "server-only";
import { db } from "@/lib/db";
import { instances, auditLog, backupPolicies, gitSources, cloudAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getProvider } from "@/lib/providers/registry";

export interface DrillCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface DrillResult {
  startedAt: Date;
  totalChecks: number;
  passed: number;
  warned: number;
  failed: number;
  checks: DrillCheck[];
  summary: string;
}

/**
 * Disaster-recovery drill. Read-only: verifies that for every running
 * production-ish VM there exists at least one backup policy, that the policy
 * has run successfully in the last 7 days, and that the provider answers
 * a listInstances call (proves the credentials still work).
 */
export async function runDrDrill(): Promise<DrillResult> {
  const startedAt = new Date();
  const checks: DrillCheck[] = [];

  const allInst = await db.select().from(instances).limit(500);
  const policies = await db.select().from(backupPolicies);
  const sources = await db.select().from(gitSources);

  const policyByInst = new Map<string, typeof policies[number]>();
  for (const p of policies) if (p.instanceId) policyByInst.set(p.instanceId, p);

  for (const i of allInst) {
    if (i.state !== "running") continue;
    const p = policyByInst.get(i.id);
    if (!p) {
      checks.push({ name: `${i.name ?? i.id} backup policy`, status: "fail", detail: "no policy bound" });
      continue;
    }
    if (!p.enabled) {
      checks.push({ name: `${i.name ?? i.id} backup policy`, status: "warn", detail: "policy disabled" });
      continue;
    }
    const stale = !p.lastRunAt || Date.now() - p.lastRunAt.getTime() > 7 * 86_400_000;
    if (stale) {
      checks.push({ name: `${i.name ?? i.id} backup freshness`, status: "warn", detail: "no successful run in 7d" });
    } else if (p.lastStatus !== "ok") {
      checks.push({ name: `${i.name ?? i.id} backup freshness`, status: "fail", detail: `last status: ${p.lastStatus ?? "?"}` });
    } else {
      checks.push({ name: `${i.name ?? i.id} backup freshness`, status: "pass", detail: `ok @ ${p.lastRunAt!.toISOString()}` });
    }
  }

  const accountIds = Array.from(new Set(allInst.map((i) => i.accountId)));
  for (const accountId of accountIds) {
    try {
      const acc = db.select().from(cloudAccounts).where(eq(cloudAccounts.id, accountId)).get();
      const region = acc?.defaultRegion ?? "";
      const { provider } = await getProvider(accountId);
      const list = await provider.listInstances(region);
      checks.push({ name: `${acc?.name ?? accountId} credentials`, status: "pass", detail: `${list.length} instance(s) reachable in ${region}` });
    } catch (e) {
      checks.push({ name: `${accountId} credentials`, status: "fail", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  for (const s of sources) {
    if (!s.enabled) continue;
    const stale = !s.lastSyncedAt || Date.now() - s.lastSyncedAt.getTime() > 24 * 60 * 60 * 1000;
    checks.push({
      name: `gitops ${s.name}`,
      status: stale ? "warn" : s.lastError ? "fail" : "pass",
      detail: s.lastError ?? (stale ? "no sync in 24h" : "ok"),
    });
  }

  const passed = checks.filter((c) => c.status === "pass").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const summary = failed === 0 && warned === 0
    ? "All systems nominal."
    : failed > 0
      ? `${failed} critical failure(s). Fix immediately.`
      : `${warned} warning(s). Investigate when possible.`;

  db.insert(auditLog).values({
    action: "dr.drill",
    target: "fleet",
    status: failed > 0 ? "error" : "ok",
    message: `pass=${passed} warn=${warned} fail=${failed}`,
  }).run();

  return { startedAt, totalChecks: checks.length, passed, warned, failed, checks, summary };
}
