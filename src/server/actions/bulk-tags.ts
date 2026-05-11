"use server";

import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, instances } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers/registry";

const schema = z.object({
  instanceIds: z.array(z.string()).min(1).max(200),
  tags: z.record(z.string().min(1).max(64), z.string().max(256)),
});

export interface BulkTagResult {
  ok: number;
  failed: { id: string; error: string }[];
}

export async function bulkApplyTags(input: {
  instanceIds: string[];
  tags: Record<string, string>;
}): Promise<BulkTagResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: 0, failed: [{ id: "*", error: parsed.error.issues.map((i) => i.message).join("; ") }] };
  }
  const { instanceIds, tags } = parsed.data;

  const rows = await db.select().from(instances).where(inArray(instances.id, instanceIds));
  const result: BulkTagResult = { ok: 0, failed: [] };

  // Group by accountId to amortize provider construction.
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
    if (!provider.applyTags) {
      for (const r of accountRows) {
        result.failed.push({ id: r.id, error: `${provider.id} does not support tagging yet` });
      }
      continue;
    }
    await Promise.all(
      accountRows.map(async (r) => {
        try {
          await provider.applyTags!(r.region, r.providerInstanceId, tags);
          await db.insert(auditLog).values({
            accountId,
            action: "instance.tag",
            target: r.id,
            status: "ok",
            message: Object.keys(tags).join(","),
          });
          result.ok++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "tag failed";
          result.failed.push({ id: r.id, error: msg });
          await db.insert(auditLog).values({
            accountId,
            action: "instance.tag",
            target: r.id,
            status: "error",
            message: msg,
          });
        }
      }),
    );
  }

  revalidatePath("/");
  revalidatePath("/instances");
  return result;
}
