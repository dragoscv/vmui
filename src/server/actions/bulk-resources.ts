"use server";

import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cachedResources, cloudAccounts, auditLog } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { revalidatePath } from "next/cache";
import {
  EC2Client,
  DeleteVolumeCommand,
  DeleteSnapshotCommand,
  DeleteKeyPairCommand,
} from "@aws-sdk/client-ec2";

/**
 * Bulk-delete AWS-only ephemeral resources. Validates each resource is
 * unattached/safe-to-delete before issuing the delete call.
 */

const bulkSchema = z.object({
  resourceIds: z.array(z.string().min(1)).min(1).max(200),
});

interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

async function loadAwsCreds(accountId: string): Promise<AwsCreds | null> {
  const rows = await db.select().from(cloudAccounts).where(eq(cloudAccounts.id, accountId)).limit(1);
  const row = rows[0];
  if (!row || row.provider !== "aws") return null;
  try {
    const c = decryptJSON<AwsCreds>(row.credentialsEnc);
    return c.accessKeyId && c.secretAccessKey ? c : null;
  } catch {
    return null;
  }
}

export async function bulkDeleteResourcesAction(input: z.infer<typeof bulkSchema>) {
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };

  const rows = await db.select().from(cachedResources).where(inArray(cachedResources.id, parsed.data.resourceIds));
  const failed: { id: string; error: string }[] = [];
  let deleted = 0;

  for (const row of rows) {
    if (row.provider !== "aws") {
      failed.push({ id: row.id, error: "Bulk-delete is AWS-only for now." });
      continue;
    }
    if (row.kind === "volume" && row.attachedToInstanceId) {
      failed.push({ id: row.id, error: "Volume is attached." });
      continue;
    }
    const creds = await loadAwsCreds(row.accountId);
    if (!creds) {
      failed.push({ id: row.id, error: "Missing AWS credentials." });
      continue;
    }
    const ec2 = new EC2Client({ region: row.region, credentials: creds });
    try {
      if (row.kind === "volume") await ec2.send(new DeleteVolumeCommand({ VolumeId: row.externalId }));
      else if (row.kind === "snapshot") await ec2.send(new DeleteSnapshotCommand({ SnapshotId: row.externalId }));
      else if (row.kind === "keypair") await ec2.send(new DeleteKeyPairCommand({ KeyPairId: row.externalId }));
      else {
        failed.push({ id: row.id, error: `Unsupported kind: ${row.kind}` });
        continue;
      }
      await db.delete(cachedResources).where(eq(cachedResources.id, row.id));
      await db.insert(auditLog).values({
        accountId: row.accountId,
        action: `resource.delete.${row.kind}`,
        target: row.externalId,
        status: "ok",
      });
      deleted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "delete failed";
      failed.push({ id: row.id, error: msg });
      await db.insert(auditLog).values({
        accountId: row.accountId,
        action: `resource.delete.${row.kind}`,
        target: row.externalId,
        status: "error",
        message: msg,
      });
    }
  }

  revalidatePath("/resources");
  return { ok: true as const, deleted, failed };
}
