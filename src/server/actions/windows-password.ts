"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { instances, auditLog } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getProvider } from "@/lib/providers/registry";
import { AwsProvider } from "@/lib/providers/aws";

const schema = z.object({
  accountId: z.string().min(1),
  providerInstanceId: z.string().min(1),
  privateKeyPem: z
    .string()
    .min(20)
    .refine(
      (v) => v.includes("-----BEGIN") && v.includes("PRIVATE KEY-----"),
      "Paste the full PEM contents — must include the BEGIN/END markers.",
    ),
});

export type GetWindowsPasswordResult =
  | { ok: true; password: string; passwordTimestamp?: string }
  | { ok: false; error: string };

export async function getWindowsPasswordAction(input: {
  accountId: string;
  providerInstanceId: string;
  privateKeyPem: string;
}): Promise<GetWindowsPasswordResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { provider } = await getProvider(parsed.data.accountId);
  if (!(provider instanceof AwsProvider)) {
    return { ok: false, error: "Windows password retrieval is only supported for AWS." };
  }

  const row = (
    await db
      .select()
      .from(instances)
      .where(
        and(
          eq(instances.accountId, parsed.data.accountId),
          eq(instances.providerInstanceId, parsed.data.providerInstanceId),
        ),
      )
      .limit(1)
  )[0];

  if (!row) return { ok: false, error: "Instance not found in local cache." };
  if (row.platform !== "windows") {
    return { ok: false, error: "This instance is not Windows." };
  }

  try {
    const result = await provider.getWindowsPassword(row.region, row.providerInstanceId, parsed.data.privateKeyPem);
    await db.insert(auditLog).values({
      accountId: parsed.data.accountId,
      action: "instance.password.decrypt",
      target: parsed.data.providerInstanceId,
      status: "ok",
    });
    return { ok: true, password: result.password, passwordTimestamp: result.passwordTimestamp };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to retrieve password.",
    };
  }
}
