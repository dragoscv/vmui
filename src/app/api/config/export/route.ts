import "server-only";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  cloudAccounts, sshKeys, schedules, instanceTags, webhooks, bootScripts,
  composeRecipes, registryCredentials, gitSources, runbooks, idleParkPolicies,
  autoTagRules, settings,
} from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Export a JSON snapshot of all user-managed config. Encrypted credential
 * blobs are included verbatim — they are useless without the master key
 * and that is intentional. Operational tables (audit_log, snapshot_history,
 * pricing_cache, sync_history, instances) are excluded by design.
 */
export async function GET() {
  await requireRole("admin");
  const [
    accounts, keys, sched, tags, hooks, boot, recipes, regs, gits, runs, idle, autotag, kv,
  ] = await Promise.all([
    db.select().from(cloudAccounts),
    db.select().from(sshKeys),
    db.select().from(schedules),
    db.select().from(instanceTags),
    db.select().from(webhooks),
    db.select().from(bootScripts),
    db.select().from(composeRecipes),
    db.select().from(registryCredentials),
    db.select().from(gitSources),
    db.select().from(runbooks),
    db.select().from(idleParkPolicies),
    db.select().from(autoTagRules),
    db.select().from(settings),
  ]);

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    note: "Encrypted credential blobs require the same VMUI_MASTER_KEY to decrypt.",
    cloudAccounts: accounts,
    sshKeys: keys,
    schedules: sched,
    instanceTags: tags,
    webhooks: hooks,
    bootScripts: boot,
    composeRecipes: recipes,
    registryCredentials: regs,
    gitSources: gits,
    runbooks: runs,
    idleParkPolicies: idle,
    autoTagRules: autotag,
    settings: kv,
  };

  const filename = `vmui-config-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
