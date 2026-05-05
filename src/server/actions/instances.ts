"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts, instances } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { getProvider } from "@/lib/providers/registry";
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

/** Sync all instances for one account across its default region. */
export async function syncAccountInstances(accountId: string): Promise<{ count: number }> {
  const { provider, account } = await getProvider(accountId);
  const region = account.defaultRegion ?? "us-east-1";
  const list = await provider.listInstances(region);

  // Replace cached rows for that account/region
  await db
    .delete(instances)
    .where(and(eq(instances.accountId, accountId), eq(instances.region, region)));

  if (list.length) {
    await db.insert(instances).values(list.map((n) => instanceRowFrom(accountId, provider.id, n)));
  }

  revalidatePath("/");
  revalidatePath(`/accounts/${accountId}`);
  return { count: list.length };
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
    const { provider } = await getProvider(parsed.data.accountId);
    const { region, providerInstanceId: id } = parsed.data;
    if (action === "start") await provider.startInstance(region, id);
    else if (action === "stop") await provider.stopInstance(region, id);
    else if (action === "reboot") await provider.rebootInstance(region, id);
    else if (action === "terminate") await provider.terminateInstance(region, id);

    await db.insert(auditLog).values({
      accountId: parsed.data.accountId,
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
            eq(instances.accountId, parsed.data.accountId),
            eq(instances.region, region),
            eq(instances.providerInstanceId, id),
          ),
        );
    }

    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Operation failed";
    await db.insert(auditLog).values({
      accountId: parsed.data.accountId,
      action: `instance.${action}`,
      target: parsed.data.providerInstanceId,
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
  const parsed = createSchema.safeParse({
    accountId: formData.get("accountId"),
    region: formData.get("region"),
    name: formData.get("name"),
    template: formData.get("template"),
    instanceType: formData.get("instanceType"),
    keyName: formData.get("keyName") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    const { provider } = await getProvider(parsed.data.accountId);
    const inst = await provider.createInstance({
      region: parsed.data.region,
      name: parsed.data.name,
      template: parsed.data.template,
      instanceType: parsed.data.instanceType,
      keyName: parsed.data.keyName,
    });

    await db.insert(instances).values(instanceRowFrom(parsed.data.accountId, provider.id, inst));
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
