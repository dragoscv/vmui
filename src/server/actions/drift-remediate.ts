"use server";
import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { instances, instanceTags, auditLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { getProvider } from "@/lib/providers/registry";

export async function pushLocalTagsToProviderAction(input: { instanceId: string }) {
  await requireRole("operator");
  const d = z.object({ instanceId: z.string().min(1) }).parse(input);

  const instRow = await db.select().from(instances).where(eq(instances.id, d.instanceId)).limit(1);
  const inst = instRow[0];
  if (!inst) return { ok: false as const, error: "instance not found" };

  const localTagsRows = await db.select().from(instanceTags).where(eq(instanceTags.instanceId, inst.id));
  const tags: Record<string, string> = {};
  for (const t of localTagsRows.filter((r) => r.source === "local")) tags[t.key] = t.value;

  const { provider } = await getProvider(inst.accountId);
  if (!provider.applyTags) {
    await db.insert(auditLog).values({
      accountId: inst.accountId, action: "drift.remediate", target: inst.providerInstanceId,
      status: "error", message: `${provider.id} does not support applyTags`,
    });
    return { ok: false as const, error: `${provider.id} does not support pushing tags` };
  }

  try {
    await provider.applyTags(inst.region, inst.providerInstanceId, tags);
    await db.insert(auditLog).values({
      accountId: inst.accountId, action: "drift.remediate", target: inst.providerInstanceId,
      status: "ok", message: `pushed ${Object.keys(tags).length} tags to provider`,
    });
    revalidatePath("/tag-drift");
    return { ok: true as const };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "applyTags failed";
    await db.insert(auditLog).values({
      accountId: inst.accountId, action: "drift.remediate", target: inst.providerInstanceId,
      status: "error", message: msg,
    });
    return { ok: false as const, error: msg };
  }
}
