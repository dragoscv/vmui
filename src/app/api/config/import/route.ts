import "server-only";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  cloudAccounts, sshKeys, schedules, instanceTags, webhooks, bootScripts,
  composeRecipes, registryCredentials, gitSources, runbooks, idleParkPolicies,
  autoTagRules, settings, auditLog,
} from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ImportPayload {
  version?: number;
  cloudAccounts?: unknown[];
  sshKeys?: unknown[];
  schedules?: unknown[];
  instanceTags?: unknown[];
  webhooks?: unknown[];
  bootScripts?: unknown[];
  composeRecipes?: unknown[];
  registryCredentials?: unknown[];
  gitSources?: unknown[];
  runbooks?: unknown[];
  idleParkPolicies?: unknown[];
  autoTagRules?: unknown[];
  settings?: unknown[];
}

/**
 * Import a JSON snapshot from /api/config/export. Default behaviour is a
 * dry-run that reports counts without writing. POST { confirm: true } to
 * actually apply. Existing rows are *replaced* (per-table truncate-and-insert)
 * — this is intended for disaster bootstrap into a fresh instance.
 */
export async function POST(req: Request) {
  await requireRole("admin");
  const url = new URL(req.url);
  const confirm = url.searchParams.get("confirm") === "1";

  let payload: ImportPayload;
  try { payload = await req.json() as ImportPayload; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ ok: false, error: "Empty payload" }, { status: 400 });
  }

  const summary: Record<string, number> = {
    cloudAccounts: payload.cloudAccounts?.length ?? 0,
    sshKeys: payload.sshKeys?.length ?? 0,
    schedules: payload.schedules?.length ?? 0,
    instanceTags: payload.instanceTags?.length ?? 0,
    webhooks: payload.webhooks?.length ?? 0,
    bootScripts: payload.bootScripts?.length ?? 0,
    composeRecipes: payload.composeRecipes?.length ?? 0,
    registryCredentials: payload.registryCredentials?.length ?? 0,
    gitSources: payload.gitSources?.length ?? 0,
    runbooks: payload.runbooks?.length ?? 0,
    idleParkPolicies: payload.idleParkPolicies?.length ?? 0,
    autoTagRules: payload.autoTagRules?.length ?? 0,
    settings: payload.settings?.length ?? 0,
  };

  if (!confirm) {
    return NextResponse.json({ ok: true, dryRun: true, wouldRestore: summary });
  }

  // Truncate-and-insert. Order matters because of FK refs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertAll = async (table: any, rows: unknown[] | undefined) => {
    if (!rows || rows.length === 0) return 0;
    await db.delete(table);
    for (const row of rows) {
      try { await db.insert(table).values(row as never); } catch { /* skip bad row */ }
    }
    return rows.length;
  };

  // Disable FKs briefly to avoid order issues on restore.
  await db.run(sql`PRAGMA foreign_keys = OFF`);
  const restored: Record<string, number> = {};
  try {
    restored.cloudAccounts = await insertAll(cloudAccounts, payload.cloudAccounts);
    restored.sshKeys = await insertAll(sshKeys, payload.sshKeys);
    restored.schedules = await insertAll(schedules, payload.schedules);
    restored.instanceTags = await insertAll(instanceTags, payload.instanceTags);
    restored.webhooks = await insertAll(webhooks, payload.webhooks);
    restored.bootScripts = await insertAll(bootScripts, payload.bootScripts);
    restored.composeRecipes = await insertAll(composeRecipes, payload.composeRecipes);
    restored.registryCredentials = await insertAll(registryCredentials, payload.registryCredentials);
    restored.gitSources = await insertAll(gitSources, payload.gitSources);
    restored.runbooks = await insertAll(runbooks, payload.runbooks);
    restored.idleParkPolicies = await insertAll(idleParkPolicies, payload.idleParkPolicies);
    restored.autoTagRules = await insertAll(autoTagRules, payload.autoTagRules);
    restored.settings = await insertAll(settings, payload.settings);
  } finally {
    await db.run(sql`PRAGMA foreign_keys = ON`);
  }

  await db.insert(auditLog).values({ action: "config.import", target: `v${payload.version ?? "?"}`, status: "ok", message: JSON.stringify(restored) });
  return NextResponse.json({ ok: true, restored });
}
