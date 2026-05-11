"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, bootScripts, cloudAccounts, instances, instanceTags, snapshotHistory, syncHistory, autoTagRules as autoTagRulesTable } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { getProvider } from "@/lib/providers/registry";
import { checkSnapshotFreshness } from "@/server/actions/snapshot-freshness";
import { requireRole } from "@/lib/auth";
import { publishEvent } from "@/lib/event-bus";
import { getInstancePrice, priceInstances } from "@/lib/pricing";
import { HOURS_PER_MONTH } from "@/lib/utils";
import { estimateVcpu } from "@/lib/vcpu";
import type { NormalizedInstance } from "@/lib/providers/types";

function instanceRowFrom(accountId: string, providerId: string, n: NormalizedInstance) {
  return {
    id: `${accountId}:${n.region}:${n.providerInstanceId}`,
    accountId,
    provider: providerId,
    region: n.region,
    providerInstanceId: n.providerInstanceId,
    name: n.name ?? null,
    state: n.state,
    platform: n.platform,
    instanceType: n.instanceType ?? null,
    publicIp: n.publicIp ?? null,
    publicDns: n.publicDns ?? null,
    privateIp: n.privateIp ?? null,
    keyName: n.keyName ?? null,
    rawJson: JSON.stringify(n.raw),
    lastSyncedAt: new Date(),
  };
}

function parseRegions(json: string | null, fallback: string | null): string[] {
  if (json) {
    try {
      const arr = JSON.parse(json) as unknown;
      if (Array.isArray(arr) && arr.every((s) => typeof s === "string") && arr.length > 0) {
        return Array.from(new Set(arr as string[]));
      }
    } catch {
      // fall through
    }
  }
  return [fallback ?? "us-east-1"];
}

/**
 * Parse the JSON map stored on `cloud_accounts.default_tags`. Tolerates
 * legacy nulls, malformed JSON, and non-string values.
 */
function parseDefaultTags(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const obj = JSON.parse(json) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof k !== "string" || k.length === 0 || k.length > 64) continue;
      const s = typeof v === "string" ? v : v == null ? "" : String(v);
      if (s.length > 256) continue;
      out[k] = s;
    }
    return out;
  } catch {
    return {};
  }
}

type AutoTagRule = { pattern: string; tags: Record<string, string> };

function parseAutoTagRules(json: string | null | undefined): AutoTagRule[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: AutoTagRule[] = [];
    for (const r of arr) {
      if (!r || typeof r !== "object") continue;
      const rec = r as Record<string, unknown>;
      const pattern = typeof rec.pattern === "string" ? rec.pattern : "";
      const tagsRaw = rec.tags;
      if (!pattern || !tagsRaw || typeof tagsRaw !== "object" || Array.isArray(tagsRaw)) continue;
      const tags: Record<string, string> = {};
      for (const [k, v] of Object.entries(tagsRaw as Record<string, unknown>)) {
        if (typeof k !== "string" || !k || k.length > 64) continue;
        const s = typeof v === "string" ? v : v == null ? "" : String(v);
        if (s.length > 256) continue;
        tags[k] = s;
      }
      if (Object.keys(tags).length > 0) out.push({ pattern, tags });
    }
    return out;
  } catch {
    return [];
  }
}

async function applyAutoTagRules(args: {
  accountId: string;
  instanceId: string;
  instanceName: string;
  rulesJson: string | null | undefined;
}): Promise<void> {
  const rules = parseAutoTagRules(args.rulesJson);
  if (rules.length === 0) return;
  const merged: Record<string, string> = {};
  for (const rule of rules) {
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern);
    } catch {
      continue;
    }
    if (re.test(args.instanceName)) {
      for (const [k, v] of Object.entries(rule.tags)) merged[k] = v;
    }
  }
  if (Object.keys(merged).length === 0) return;
  const existing = await db
    .select({ key: instanceTags.key })
    .from(instanceTags)
    .where(eq(instanceTags.instanceId, args.instanceId));
  const have = new Set(existing.map((r) => r.key));
  const toInsert = Object.entries(merged)
    .filter(([k]) => !have.has(k))
    .map(([key, value]) => ({
      id: nanoid(),
      instanceId: args.instanceId,
      key,
      value,
      source: "local" as const,
    }));
  if (toInsert.length > 0) {
    await db.insert(instanceTags).values(toInsert);
  }
}

/** Apply globally-configured auto-tag rules (from the auto_tag_rules table). */
async function applyGlobalAutoTagRules(args: {
  instanceId: string;
  instanceName: string;
  rules: { namePattern: string; tagKey: string; tagValue: string; enabled: number; priority: number }[];
}): Promise<void> {
  if (args.rules.length === 0) return;
  const merged: Record<string, string> = {};
  for (const rule of args.rules.filter((r) => r.enabled === 1)) {
    let re: RegExp;
    try { re = new RegExp(rule.namePattern); } catch { continue; }
    if (re.test(args.instanceName)) merged[rule.tagKey] = rule.tagValue;
  }
  if (Object.keys(merged).length === 0) return;
  const existing = await db
    .select({ key: instanceTags.key })
    .from(instanceTags)
    .where(eq(instanceTags.instanceId, args.instanceId));
  const have = new Set(existing.map((r) => r.key));
  const toInsert = Object.entries(merged)
    .filter(([k]) => !have.has(k))
    .map(([key, value]) => ({
      id: nanoid(),
      instanceId: args.instanceId,
      key,
      value,
      source: "local" as const,
    }));
  if (toInsert.length > 0) await db.insert(instanceTags).values(toInsert);
}

/** Sync all instances for one account across every configured region in parallel. */
export async function syncAccountInstances(accountId: string): Promise<{ count: number }> {
  const { provider, account } = await getProvider(accountId);
  const regions = parseRegions(account.regions, account.defaultRegion);

  const globalAutoTagRules = await db.select().from(autoTagRulesTable);

  // Snapshot prior states so we can emit instance.changed events on diff.
  const priorRows = await db.select().from(instances).where(eq(instances.accountId, accountId));
  const priorByKey = new Map<string, string>();
  for (const r of priorRows) {
    priorByKey.set(`${r.region}:${r.providerInstanceId}`, r.state);
  }

  const perRegion = await Promise.all(
    regions.map(async (region) => {
      const t0 = Date.now();
      try {
        const list = await provider.listInstances(region);
        const priorRegion = priorRows.filter((r) => r.region === region);
        const priorKeys = new Set(priorRegion.map((r) => r.providerInstanceId));
        const newKeys = new Set(list.map((n) => n.providerInstanceId));
        const addedIds = list.filter((n) => !priorKeys.has(n.providerInstanceId)).map((n) => n.providerInstanceId);
        const removedIds = priorRegion.filter((r) => !newKeys.has(r.providerInstanceId)).map((r) => r.providerInstanceId);
        const stateChanges: Array<{ id: string; from: string; to: string }> = [];
        for (const n of list) {
          const prev = priorByKey.get(`${region}:${n.providerInstanceId}`);
          if (prev && prev !== n.state) stateChanges.push({ id: n.providerInstanceId, from: prev, to: n.state });
        }
        const added = addedIds.length;
        const removed = removedIds.length;
        const stateChanged = stateChanges.length;
        const durationMs = Date.now() - t0;
        if (added + removed + stateChanged > 0) {
          await db.insert(syncHistory).values({
            id: nanoid(),
            accountId,
            region,
            durationMs,
            total: list.length,
            added,
            removed,
            stateChanged,
            detailsJson: JSON.stringify({ added: addedIds, removed: removedIds, stateChanged: stateChanges }),
          });
        }
        publishEvent({
          channel: "sync.completed",
          payload: {
            accountId,
            region,
            count: list.length,
            durationMs,
            added,
            removed,
            stateChanged,
          },
        });
        return { region, list };
      } catch (err) {
        await db.insert(auditLog).values({
          accountId,
          action: "sync.region",
          target: region,
          status: "error",
          message: err instanceof Error ? err.message : "Failed",
        });
        return { region, list: [] as NormalizedInstance[] };
      }
    }),
  );

  let total = 0;
  for (const { region, list } of perRegion) {
    total += list.length;
    // Per-region delete-stale + upsert preserves user fields and respects scope.
    const keepIds = list.map((n) => n.providerInstanceId);
    if (keepIds.length === 0) {
      await db
        .delete(instances)
        .where(and(eq(instances.accountId, accountId), eq(instances.region, region)));
    } else {
      await db
        .delete(instances)
        .where(
          and(
            eq(instances.accountId, accountId),
            eq(instances.region, region),
            notInArray(instances.providerInstanceId, keepIds),
          ),
        );
    }

    for (const n of list) {
      const row = instanceRowFrom(accountId, provider.id, n);
      const key = `${region}:${n.providerInstanceId}`;
      const prev = priorByKey.get(key) ?? null;
      const stateChanged = prev !== row.state;
      if (stateChanged) {
        publishEvent({
          channel: "instance.changed",
          payload: {
            accountId,
            providerInstanceId: n.providerInstanceId,
            state: row.state,
            prev,
          },
        });
      }
      const lastStateChangeAt = stateChanged ? new Date() : undefined;
      await db
        .insert(instances)
        .values({ ...row, lastStateChangeAt: lastStateChangeAt ?? null })
        .onConflictDoUpdate({
          target: instances.id,
          set: {
            name: row.name,
            state: row.state,
            platform: row.platform,
            instanceType: row.instanceType,
            publicIp: row.publicIp,
            publicDns: row.publicDns,
            privateIp: row.privateIp,
            keyName: row.keyName,
            rawJson: row.rawJson,
            lastSyncedAt: row.lastSyncedAt,
            ...(lastStateChangeAt ? { lastStateChangeAt } : {}),
          },
        });
      await applyAutoTagRules({
        accountId,
        instanceId: row.id,
        instanceName: row.name ?? row.providerInstanceId,
        rulesJson: account.autoTagRules,
      });
      await applyGlobalAutoTagRules({
        instanceId: row.id,
        instanceName: row.name ?? row.providerInstanceId,
        rules: globalAutoTagRules,
      });
    }
  }

  revalidatePath("/");
  revalidatePath(`/accounts/${accountId}`);

  // Capture a history snapshot for sparklines. Cheap: one row per sync.
  try {
    const accountRows = await db.select().from(instances).where(eq(instances.accountId, accountId));
    const running = accountRows.filter((r) => r.state === "running").length;
    const priceMap = await priceInstances(
      accountRows
        .filter((r) => r.state === "running")
        .map((r) => ({
          id: r.id,
          provider: r.provider,
          region: r.region,
          instanceType: r.instanceType,
          platform: r.platform,
          accountId: r.accountId,
        })),
    );
    const hourly = Object.values(priceMap).reduce((sum, p) => sum + (p.usdPerHour ?? 0), 0);
    await db.insert(snapshotHistory).values({
      id: nanoid(),
      accountId,
      totalInstances: accountRows.length,
      runningInstances: running,
      hourlyUsd: Number(hourly.toFixed(4)),
    });
  } catch {
    // Non-fatal — sparklines are decorative.
  }

  return { count: total };
}

/** Sync every connected account. */
export async function syncAllAccounts(): Promise<{ accounts: number; instances: number }> {
  const accounts = await db.select().from(cloudAccounts);
  let total = 0;
  for (const a of accounts) {
    try {
      const r = await syncAccountInstances(a.id);
      total += r.count;
    } catch (err) {
      await db.insert(auditLog).values({
        accountId: a.id,
        action: "sync",
        status: "error",
        message: err instanceof Error ? err.message : "sync failed",
      });
    }
  }
  return { accounts: accounts.length, instances: total };
}

const opSchema = z.object({
  accountId: z.string().min(1),
  region: z.string().min(1),
  providerInstanceId: z.string().min(1),
});

type Action = "start" | "stop" | "reboot" | "terminate";

export async function instanceAction(
  action: Action,
  input: z.infer<typeof opSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = opSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }

  return executeInstanceAction(action, parsed.data);
}

export async function executeInstanceAction(
  action: Action,
  data: z.infer<typeof opSchema>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { provider, account } = await getProvider(data.accountId);
    const { region, providerInstanceId: id } = data;

    if (action === "terminate") {
      const row = await db.query.instances.findFirst({
        where: and(
          eq(instances.accountId, data.accountId),
          eq(instances.region, region),
          eq(instances.providerInstanceId, id),
        ),
      });
      if (row?.terminationLocked) {
        await db.insert(auditLog).values({
          accountId: data.accountId,
          action: "instance.terminate.blocked",
          target: id,
          status: "error",
          message: "termination locked",
        });
        return { ok: false, error: "This instance is termination-locked. Unlock it from the instance detail page first." };
      }
    }

    if (action === "terminate" && account.safeTerminate && provider.createSnapshot) {
      const fresh = await checkSnapshotFreshness({
        accountId: data.accountId,
        region,
        providerInstanceId: id,
      });
      if (!fresh.hasRecent) {
        try {
          const label = `safe-terminate-${new Date().toISOString().replace(/[:.]/g, "-")}`;
          const snap = await provider.createSnapshot(region, id, label);
          await db.insert(auditLog).values({
            accountId: data.accountId,
            action: "instance.terminate.safe-snapshot",
            target: id,
            status: "ok",
            message: snap.snapshotId,
          });
        } catch (err) {
          await db.insert(auditLog).values({
            accountId: data.accountId,
            action: "instance.terminate.safe-snapshot",
            target: id,
            status: "error",
            message: err instanceof Error ? err.message : "snapshot failed",
          });
        }
      }
    }

    if (action === "start") await provider.startInstance(region, id);
    else if (action === "stop") await provider.stopInstance(region, id);
    else if (action === "reboot") await provider.rebootInstance(region, id);
    else if (action === "terminate") await provider.terminateInstance(region, id);

    await db.insert(auditLog).values({
      accountId: data.accountId,
      action: `instance.${action}`,
      target: id,
      status: "ok",
    });

    // Optimistic state update in cache
    const newState =
      action === "start" ? "pending" : action === "stop" ? "stopping" : action === "terminate" ? "shutting-down" : undefined;
    if (newState) {
      await db
        .update(instances)
        .set({ state: newState })
        .where(
          and(
            eq(instances.accountId, data.accountId),
            eq(instances.region, region),
            eq(instances.providerInstanceId, id),
          ),
        );
      publishEvent({
        channel: "instance.changed",
        payload: {
          accountId: data.accountId,
          providerInstanceId: id,
          state: newState,
          prev: null,
        },
      });
      try {
        const { fireWebhooksForState } = await import("@/server/actions/extras");
        await fireWebhooksForState({
          accountId: data.accountId,
          providerInstanceId: id,
          instanceName: id,
          from: "?",
          to: newState,
        });
      } catch { /* never block */ }
    }

    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Operation failed";
    await db.insert(auditLog).values({
      accountId: data.accountId,
      action: `instance.${action}`,
      target: data.providerInstanceId,
      status: "error",
      message: msg,
    });
    return { ok: false, error: msg };
  }
}

const createSchema = z.object({
  accountId: z.string().min(1),
  region: z.string().min(1),
  name: z.string().min(1).max(64),
  template: z.string().min(1),
  instanceType: z.string().min(1),
  keyName: z.string().optional(),
  sshPublicKey: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  bootScriptId: z.string().optional(),
});

export type CreateInstanceState = {
  ok?: boolean;
  error?: string;
  instanceId?: string;
};

export async function createInstanceAction(
  _prev: CreateInstanceState,
  formData: FormData,
): Promise<CreateInstanceState> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = createSchema.safeParse({
    accountId: formData.get("accountId"),
    region: formData.get("region"),
    name: formData.get("name"),
    template: formData.get("template"),
    instanceType: formData.get("instanceType"),
    keyName: formData.get("keyName") || undefined,
    sshPublicKey: formData.get("sshPublicKey") || undefined,
    username: formData.get("username") || undefined,
    password: formData.get("password") || undefined,
    bootScriptId: formData.get("bootScriptId") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    const { provider } = await getProvider(parsed.data.accountId);

    const accountRow0 = await db.query.cloudAccounts.findFirst({
      where: eq(cloudAccounts.id, parsed.data.accountId),
    });
    if (accountRow0?.monthlyBudgetUsd != null) {
      const cap = accountRow0.monthlyBudgetUsd;
      const running = await db
        .select()
        .from(instances)
        .where(and(eq(instances.accountId, parsed.data.accountId), eq(instances.state, "running")));
      const priced = await priceInstances(running);
      const currentHourly = Object.values(priced).reduce((s, p) => s + (p.usdPerHour ?? 0), 0);
      const newQuote = await getInstancePrice(
        provider.id,
        parsed.data.region,
        parsed.data.instanceType,
        parsed.data.template.includes("windows") ? "windows" : "linux",
        parsed.data.accountId,
      );
      const newHourly = newQuote?.usdPerHour ?? 0;
      const projected = (currentHourly + newHourly) * HOURS_PER_MONTH;
      if (projected > cap) {
        await db.insert(auditLog).values({
          accountId: parsed.data.accountId,
          action: "instance.create.blocked",
          target: parsed.data.name,
          status: "error",
          message: `projected $${projected.toFixed(0)}/mo > cap $${cap.toFixed(0)}/mo`,
        });
        return {
          ok: false,
          error: `Account budget cap: launching this instance would project to $${projected.toFixed(0)}/mo (cap $${cap.toFixed(0)}/mo).`,
        };
      }
    }

    if (accountRow0?.vcpuQuota != null) {
      const cap = accountRow0.vcpuQuota;
      const runningForVcpu = await db
        .select()
        .from(instances)
        .where(and(eq(instances.accountId, parsed.data.accountId), eq(instances.state, "running")));
      const currentVcpu = runningForVcpu.reduce(
        (s, i) => s + (estimateVcpu(i.instanceType) ?? 0),
        0,
      );
      const newVcpu = estimateVcpu(parsed.data.instanceType) ?? 0;
      if (currentVcpu + newVcpu > cap) {
        await db.insert(auditLog).values({
          accountId: parsed.data.accountId,
          action: "instance.create.blocked",
          target: parsed.data.name,
          status: "error",
          message: `vcpu ${currentVcpu}+${newVcpu} > cap ${cap}`,
        });
        return {
          ok: false,
          error: `Account vCPU quota: this would use ${currentVcpu + newVcpu} vCPUs (cap ${cap}).`,
        };
      }
    }

    // Required-tags enforcement at create-time. We can only auto-apply tags
    // that live in `default_tags`, so refuse the create when a required key
    // isn't covered there. Compliance still flags missing tags after the fact.
    if (accountRow0?.requiredTags) {
      let required: string[] = [];
      try {
        const parsed2 = JSON.parse(accountRow0.requiredTags) as unknown;
        if (Array.isArray(parsed2)) {
          required = parsed2.filter((s): s is string => typeof s === "string" && s.length > 0);
        }
      } catch {
        /* ignore malformed JSON; treat as no requirement */
      }
      if (required.length > 0) {
        const defaultTags = parseDefaultTags(accountRow0.defaultTags ?? null);
        const missing = required.filter((k) => !(k in defaultTags));
        if (missing.length > 0) {
          await db.insert(auditLog).values({
            accountId: parsed.data.accountId,
            action: "instance.create.blocked",
            target: parsed.data.name,
            status: "error",
            message: `missing required tag${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
          });
          return {
            ok: false,
            error: `Account requires tag${missing.length === 1 ? "" : "s"} not present in default_tags: ${missing.join(", ")}. Add them on the account settings page.`,
          };
        }
      }
    }

    const inst = await provider.createInstance({
      region: parsed.data.region,
      name: parsed.data.name,
      template: parsed.data.template,
      instanceType: parsed.data.instanceType,
      keyName: parsed.data.keyName,
      sshPublicKey: parsed.data.sshPublicKey,
      username: parsed.data.username,
      password: parsed.data.password,
      userData: parsed.data.bootScriptId
        ? (await db.query.bootScripts.findFirst({ where: eq(bootScripts.id, parsed.data.bootScriptId) }))?.body
        : undefined,
    });

    await db.insert(instances).values(instanceRowFrom(parsed.data.accountId, provider.id, inst));

    const accountRow = await db.query.cloudAccounts.findFirst({
      where: eq(cloudAccounts.id, parsed.data.accountId),
    });
    const defaultTags = parseDefaultTags(accountRow?.defaultTags ?? null);
    if (Object.keys(defaultTags).length > 0) {
      const instanceId = `${parsed.data.accountId}:${inst.region}:${inst.providerInstanceId}`;
      await db.insert(instanceTags).values(
        Object.entries(defaultTags).map(([key, value]) => ({
          id: nanoid(),
          instanceId,
          key,
          value,
          source: "local" as const,
        })),
      );
      if (provider.applyTags) {
        try {
          await provider.applyTags(inst.region, inst.providerInstanceId, defaultTags);
        } catch {
          // Provider tagging is best-effort; the local rows already record intent.
        }
      }
    }

    await db.insert(auditLog).values({
      accountId: parsed.data.accountId,
      action: "instance.create",
      target: inst.providerInstanceId,
      status: "ok",
      message: `Created ${parsed.data.name} (${parsed.data.instanceType})`,
    });

    revalidatePath("/");
    return { ok: true, instanceId: `${parsed.data.accountId}:${inst.region}:${inst.providerInstanceId}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Create failed" };
  }
}

export async function getConnectionInfoAction(input: z.infer<typeof opSchema>) {
  const parsed = opSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    const { provider } = await getProvider(parsed.data.accountId);
    const info = await provider.getConnectionInfo(parsed.data.region, parsed.data.providerInstanceId);
    return { ok: true as const, info };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Read-only helper to display the saved AWS account label. */
export async function getAccountMetadata(accountId: string) {
  const row = await db.query.cloudAccounts.findFirst({
    where: eq(cloudAccounts.id, accountId),
  });
  if (!row) return null;
  if (!row.metadataEnc) return { name: row.name, label: row.name, accountId: null as string | null };
  const meta = decryptJSON<{ accountId: string; label: string }>(row.metadataEnc);
  return { name: row.name, label: meta.label, accountId: meta.accountId };
}

/* ------------------------------ user-edit actions ----------------------------- */

const renameSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().max(80).nullable(),
});

export async function renameInstanceAction(
  input: z.infer<typeof renameSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid name" };
  const value = parsed.data.displayName?.trim() || null;
  await db
    .update(instances)
    .set({ displayName: value })
    .where(eq(instances.id, parsed.data.id));
  await db.insert(auditLog).values({
    action: "instance.rename",
    target: parsed.data.id,
    status: "ok",
    message: value ?? "(cleared)",
  });
  revalidatePath("/");
  return { ok: true };
}

const pinSchema = z.object({ id: z.string().min(1), pinned: z.boolean() });
export async function setInstancePinnedAction(
  input: z.infer<typeof pinSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  await db
    .update(instances)
    .set({ pinned: parsed.data.pinned })
    .where(eq(instances.id, parsed.data.id));
  revalidatePath("/");
  return { ok: true };
}

const notesSchema = z.object({ id: z.string().min(1), notes: z.string().max(2000).nullable() });
export async function setInstanceNotesAction(
  input: z.infer<typeof notesSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = notesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid notes" };
  await db
    .update(instances)
    .set({ notes: parsed.data.notes?.trim() || null })
    .where(eq(instances.id, parsed.data.id));
  revalidatePath("/");
  return { ok: true };
}

const reorderSchema = z.object({ ids: z.array(z.string().min(1)).max(500) });
export async function reorderInstancesAction(
  input: z.infer<typeof reorderSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  // Assign sortOrder = position * 10 for the supplied set, in a single transaction.
  const ids = parsed.data.ids;
  if (ids.length === 0) return { ok: true };
  db.transaction((tx) => {
    for (let i = 0; i < ids.length; i++) {
      tx.run(sql`UPDATE instances SET sort_order = ${i * 10} WHERE id = ${ids[i]}`);
    }
  });
  revalidatePath("/");
  return { ok: true };
}

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["start", "stop", "reboot", "terminate", "snapshot"]),
});
export async function bulkInstanceAction(
  input: z.infer<typeof bulkSchema>,
): Promise<{ ok: boolean; succeeded: number; failed: number; errors: string[] }> {
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, succeeded: 0, failed: 0, errors: ["Invalid input"] };
  const rows = await db
    .select()
    .from(instances)
    .where(inArray(instances.id, parsed.data.ids));
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];
  if (parsed.data.action === "snapshot") {
    try {
      await requireRole("operator");
    } catch (err) {
      return { ok: false, succeeded: 0, failed: rows.length, errors: [err instanceof Error ? err.message : "Not authorized"] };
    }
    for (const r of rows) {
      try {
        const { provider } = await getProvider(r.accountId);
        if (!provider.createSnapshot) throw new Error(`${provider.id} does not support snapshots`);
        const label = `bulk-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        await provider.createSnapshot(r.region, r.providerInstanceId, label);
        await db.insert(auditLog).values({
          accountId: r.accountId,
          action: "instance.snapshot.bulk",
          target: r.providerInstanceId,
          status: "ok",
          message: label,
        });
        succeeded++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : "snapshot failed";
        errors.push(msg);
        await db.insert(auditLog).values({
          accountId: r.accountId,
          action: "instance.snapshot.bulk",
          target: r.providerInstanceId,
          status: "error",
          message: msg,
        });
      }
    }
    return { ok: failed === 0, succeeded, failed, errors };
  }
  for (const r of rows) {
    const res = await instanceAction(parsed.data.action, {
      accountId: r.accountId,
      region: r.region,
      providerInstanceId: r.providerInstanceId,
    });
    if (res.ok) succeeded++;
    else {
      failed++;
      if (res.error) errors.push(res.error);
    }
  }
  return { ok: failed === 0, succeeded, failed, errors };
}
