"use server";

import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { desc, eq, sql as dsql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  auditLog,
  composeRecipes,
  composeRecipeVersions,
  type ComposeRecipeRow,
  type ComposeRecipeVersionRow,
} from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { sshExec } from "@/lib/ssh-exec";
import { decryptJSON } from "@/lib/crypto";
import { cloudAccounts, instances } from "@/lib/db/schema";
import type { ProbeKey } from "@/lib/probe";

const upsertSchema = z.object({
  id: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9 ._-]+$/u, "Use only letters, digits, space, dash, dot, underscore"),
  description: z.string().max(280).optional().nullable(),
  body: z.string().min(1).max(128 * 1024),
  buildLocation: z.enum(["local", "remote"]).default("remote"),
  note: z.string().max(160).optional().nullable(),
});

export async function listComposeRecipesAction(): Promise<ComposeRecipeRow[]> {
  return db.select().from(composeRecipes).orderBy(desc(composeRecipes.updatedAt));
}

export async function getComposeRecipeAction(
  id: string,
): Promise<{ recipe: ComposeRecipeRow | null; versions: ComposeRecipeVersionRow[] }> {
  const rec = await db.query.composeRecipes.findFirst({ where: eq(composeRecipes.id, id) });
  if (!rec) return { recipe: null, versions: [] };
  const versions = await db
    .select()
    .from(composeRecipeVersions)
    .where(eq(composeRecipeVersions.recipeId, id))
    .orderBy(desc(composeRecipeVersions.version));
  return { recipe: rec, versions };
}

export async function upsertComposeRecipeAction(
  input: z.infer<typeof upsertSchema>,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  const { id, name, description, body, buildLocation, note } = parsed.data;

  const now = new Date();
  if (id) {
    await db
      .update(composeRecipes)
      .set({ name, description: description ?? null, body, buildLocation, updatedAt: now })
      .where(eq(composeRecipes.id, id));
    const [maxRow] = await db
      .select({ m: dsql<number>`coalesce(max(version), 0)` })
      .from(composeRecipeVersions)
      .where(eq(composeRecipeVersions.recipeId, id));
    const nextVer = (maxRow?.m ?? 0) + 1;
    await db.insert(composeRecipeVersions).values({
      id: nanoid(),
      recipeId: id,
      version: nextVer,
      body,
      note: note ?? null,
    });
    await db.insert(auditLog).values({ action: "compose.update", target: id, status: "ok", message: `v${nextVer}` });
    revalidatePath("/compose");
    return { ok: true, id };
  }
  const newId = nanoid();
  await db.insert(composeRecipes).values({
    id: newId,
    name,
    description: description ?? null,
    body,
    buildLocation,
  });
  await db.insert(composeRecipeVersions).values({
    id: nanoid(),
    recipeId: newId,
    version: 1,
    body,
    note: note ?? "initial",
  });
  await db.insert(auditLog).values({ action: "compose.create", target: newId, status: "ok", message: name });
  revalidatePath("/compose");
  return { ok: true, id: newId };
}

export async function deleteComposeRecipeAction(id: string): Promise<{ ok: boolean }> {
  try {
    await requireRole("operator");
  } catch {
    return { ok: false };
  }
  await db.delete(composeRecipes).where(eq(composeRecipes.id, id));
  await db.insert(auditLog).values({ action: "compose.delete", target: id, status: "ok" });
  revalidatePath("/compose");
  return { ok: true };
}

interface SshTarget {
  host: string;
  port: number;
  user: string;
  key: ProbeKey;
}

async function loadSshTarget(instanceId: string): Promise<SshTarget> {
  const inst = await db.query.instances.findFirst({ where: eq(instances.id, instanceId) });
  if (!inst) throw new Error("Instance not found");
  if (!inst.publicIp && !inst.publicDns) throw new Error("Instance has no public IP/DNS");
  if (inst.platform !== "linux") throw new Error("Compose apply requires a Linux guest");
  const acc = await db.query.cloudAccounts.findFirst({ where: eq(cloudAccounts.id, inst.accountId) });
  if (!acc?.probeKeyEnc) throw new Error("No probe key for this account");
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  return {
    host: inst.publicIp ?? inst.publicDns!,
    port: 22,
    user: key.defaultUser ?? (inst.provider === "aws" ? "ec2-user" : "ubuntu"),
    key,
  };
}

const applySchema = z.object({
  recipeId: z.string().min(1),
  instanceId: z.string().min(1),
});

export async function applyComposeRecipeAction(input: z.infer<typeof applySchema>): Promise<{
  ok: boolean;
  output: string;
  error?: string;
}> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, output: "", error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { ok: false, output: "", error: "Bad input" };
  const { recipeId, instanceId } = parsed.data;
  const rec = await db.query.composeRecipes.findFirst({ where: eq(composeRecipes.id, recipeId) });
  if (!rec) return { ok: false, output: "", error: "Recipe not found" };

  let target: SshTarget;
  try {
    target = await loadSshTarget(instanceId);
  } catch (err) {
    return { ok: false, output: "", error: err instanceof Error ? err.message : "Failed" };
  }

  const safeName = rec.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const dir = `/opt/compose/${safeName}`;
  const b64 = Buffer.from(rec.body, "utf8").toString("base64");
  const script = `set -e
sudo mkdir -p ${dir}
echo ${b64} | base64 -d | sudo tee ${dir}/docker-compose.yml > /dev/null
cd ${dir}
sudo docker compose pull 2>&1 || true
sudo docker compose up -d 2>&1`;
  try {
    const res = await sshExec({ ...target, command: script, timeoutMs: 300_000 });
    const ok = res.code === 0;
    await db.insert(auditLog).values({
      action: "compose.apply",
      target: `${recipeId}:${instanceId}`,
      status: ok ? "ok" : "error",
      message: (res.stdout + res.stderr).slice(0, 512),
    });
    return { ok, output: res.stdout + res.stderr };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    await db.insert(auditLog).values({
      action: "compose.apply",
      target: `${recipeId}:${instanceId}`,
      status: "error",
      message: msg,
    });
    return { ok: false, output: "", error: msg };
  }
}
