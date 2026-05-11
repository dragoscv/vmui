"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditLog, instances } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers/registry";
import { requireRole } from "@/lib/auth";

export interface RecipeResult {
  ok: number;
  failed: { id: string; error: string }[];
  totalCandidates: number;
}

interface FilterArgs {
  accountId?: string;
  tag?: { key: string; value?: string };
}

async function selectInstances(filter: FilterArgs, requireState: "running" | "stopped" | "all") {
  const all = filter.accountId
    ? await db.select().from(instances).where(eq(instances.accountId, filter.accountId))
    : await db.select().from(instances);

  return all.filter((i) => {
    if (requireState === "running" && i.state !== "running") return false;
    if (requireState === "stopped" && i.state !== "stopped") return false;
    if (filter.tag) {
      try {
        const raw = i.rawJson ? JSON.parse(i.rawJson) : {};
        const tags = (raw as { Tags?: { Key: string; Value: string }[]; tags?: Record<string, string> })
          .Tags;
        const labels = (raw as { tags?: Record<string, string>; labels?: Record<string, string> }).tags
          ?? (raw as { labels?: Record<string, string> }).labels
          ?? {};
        if (tags) {
          const hit = tags.find((t) => t.Key === filter.tag!.key);
          if (!hit) return false;
          if (filter.tag!.value && hit.Value !== filter.tag!.value) return false;
        } else {
          const v = labels[filter.tag!.key];
          if (v == null) return false;
          if (filter.tag!.value && v !== filter.tag!.value) return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  });
}

async function applyAction(
  rows: Awaited<ReturnType<typeof selectInstances>>,
  fn: "stopInstance" | "startInstance" | "rebootInstance",
  recipeName: string,
): Promise<RecipeResult> {
  const result: RecipeResult = { ok: 0, failed: [], totalCandidates: rows.length };

  const byAccount = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byAccount.get(r.accountId) ?? [];
    arr.push(r);
    byAccount.set(r.accountId, arr);
  }

  for (const [accountId, accountRows] of byAccount) {
    let provider;
    try {
      ({ provider } = await getProvider(accountId));
    } catch (e) {
      for (const r of accountRows) {
        result.failed.push({ id: r.id, error: e instanceof Error ? e.message : "provider error" });
      }
      continue;
    }
    await Promise.all(
      accountRows.map(async (r) => {
        try {
          await provider[fn](r.region, r.providerInstanceId);
          await db.insert(auditLog).values({
            accountId,
            action: `recipe.${recipeName}`,
            target: r.id,
            status: "ok",
          });
          result.ok++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "failed";
          result.failed.push({ id: r.id, error: msg });
          await db.insert(auditLog).values({
            accountId,
            action: `recipe.${recipeName}`,
            target: r.id,
            status: "error",
            message: msg,
          });
        }
      }),
    );
  }
  revalidatePath("/");
  return result;
}

export async function recipeStopAllRunning(filter: FilterArgs = {}): Promise<RecipeResult> {
  try { await requireRole("operator"); } catch (err) { return { ok: 0, failed: [{ id: "_auth", error: err instanceof Error ? err.message : "Not authorized" }], totalCandidates: 0 }; }
  const rows = await selectInstances(filter, "running");
  return applyAction(rows, "stopInstance", "stop-all-running");
}

export async function recipeStartAllStopped(filter: FilterArgs = {}): Promise<RecipeResult> {
  try { await requireRole("operator"); } catch (err) { return { ok: 0, failed: [{ id: "_auth", error: err instanceof Error ? err.message : "Not authorized" }], totalCandidates: 0 }; }
  const rows = await selectInstances(filter, "stopped");
  return applyAction(rows, "startInstance", "start-all-stopped");
}

export async function recipeRebootAllRunning(filter: FilterArgs = {}): Promise<RecipeResult> {
  try { await requireRole("operator"); } catch (err) { return { ok: 0, failed: [{ id: "_auth", error: err instanceof Error ? err.message : "Not authorized" }], totalCandidates: 0 }; }
  const rows = await selectInstances(filter, "running");
  return applyAction(rows, "rebootInstance", "reboot-all-running");
}

/** Dry-run: returns the list of candidate instances for a given recipe filter. */
export async function recipeDryRun(
  recipe: "stop-all-running" | "start-all-stopped" | "reboot-all-running",
  filter: FilterArgs = {},
): Promise<{ id: string; name: string | null; provider: string; region: string }[]> {
  const state = recipe === "start-all-stopped" ? "stopped" : "running";
  const rows = await selectInstances(filter, state);
  return rows.map((r) => ({
    id: r.id,
    name: r.displayName ?? r.name,
    provider: r.provider,
    region: r.region,
  }));
}
