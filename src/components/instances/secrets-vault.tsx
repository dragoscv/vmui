import { db } from "@/lib/db";
import { instanceSecrets } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { SecretsVaultClient } from "./secrets-vault.client";

export async function SecretsVault({ accountId, providerInstanceId }: { accountId: string; providerInstanceId: string }) {
  const rows = await db.select({ id: instanceSecrets.id, key: instanceSecrets.key, updatedAt: instanceSecrets.updatedAt }).from(instanceSecrets)
    .where(and(eq(instanceSecrets.accountId, accountId), eq(instanceSecrets.providerInstanceId, providerInstanceId)))
    .orderBy(desc(instanceSecrets.updatedAt));
  return <SecretsVaultClient accountId={accountId} providerInstanceId={providerInstanceId} initial={rows} />;
}
