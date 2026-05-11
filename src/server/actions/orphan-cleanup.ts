"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  EC2Client,
  DeleteVolumeCommand,
  DeleteSnapshotCommand,
  ReleaseAddressCommand,
} from "@aws-sdk/client-ec2";
import { db } from "@/lib/db";
import { auditLog, cachedResources, cloudAccounts } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { requireRole } from "@/lib/auth";

const ALLOWED_KINDS = ["volume", "snapshot", "elastic-ip"] as const;
type OrphanKind = (typeof ALLOWED_KINDS)[number];

const schema = z.object({
  accountId: z.string().min(1),
  resourceId: z.string().min(1),
});

interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  defaultRegion?: string;
}

/**
 * Delete an orphaned AWS resource flagged by the compliance scanner. Only
 * accepts kinds that are safe to delete unattended (volume, snapshot,
 * elastic-ip). The resource must be cached locally and currently unattached.
 * Refuses to act on attached resources even if the cache disagrees with the
 * provider: AWS itself will reject the call, and we surface the error.
 */
export async function deleteOrphanResourceAction(
  input: z.infer<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole("operator");

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { accountId, resourceId } = parsed.data;

  const rows = await db
    .select()
    .from(cachedResources)
    .where(and(eq(cachedResources.accountId, accountId), eq(cachedResources.id, resourceId)))
    .limit(1);
  const resource = rows[0];
  if (!resource) return { ok: false, error: "Resource not found in cache." };
  if (!(ALLOWED_KINDS as readonly string[]).includes(resource.kind)) {
    return { ok: false, error: `Cleanup not supported for resource kind "${resource.kind}".` };
  }
  if (resource.attachedToInstanceId) {
    return { ok: false, error: "Resource is still attached. Refresh the sync and try again." };
  }
  if (resource.provider !== "aws") {
    return { ok: false, error: `Cleanup not yet implemented for provider "${resource.provider}".` };
  }

  const acctRows = await db
    .select()
    .from(cloudAccounts)
    .where(eq(cloudAccounts.id, accountId))
    .limit(1);
  const account = acctRows[0];
  if (!account || account.provider !== "aws") {
    return { ok: false, error: "AWS account not found." };
  }

  let creds: AwsCreds;
  try {
    creds = decryptJSON<AwsCreds>(account.credentialsEnc);
  } catch {
    return { ok: false, error: "Could not decrypt AWS credentials." };
  }
  if (!creds.accessKeyId || !creds.secretAccessKey) {
    return { ok: false, error: "AWS credentials are incomplete." };
  }

  const ec2 = new EC2Client({
    region: resource.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    },
  });

  const kind = resource.kind as OrphanKind;
  try {
    if (kind === "volume") {
      await ec2.send(new DeleteVolumeCommand({ VolumeId: resource.externalId }));
    } else if (kind === "snapshot") {
      const ids = resource.externalId.split(",").map((s) => s.trim()).filter(Boolean);
      for (const id of ids) {
        await ec2.send(new DeleteSnapshotCommand({ SnapshotId: id }));
      }
    } else if (kind === "elastic-ip") {
      await ec2.send(new ReleaseAddressCommand({ AllocationId: resource.externalId }));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "AWS rejected the request.";
    await db.insert(auditLog).values({
      accountId,
      action: `orphan-cleanup.${kind}`,
      target: resource.externalId,
      status: "error",
      message,
    });
    return { ok: false, error: message };
  }

  await db.delete(cachedResources).where(eq(cachedResources.id, resourceId));
  await db.insert(auditLog).values({
    accountId,
    action: `orphan-cleanup.${kind}`,
    target: resource.externalId,
    status: "ok",
    message: `Deleted orphan ${kind} ${resource.externalId} in ${resource.region}.`,
  });

  revalidatePath("/compliance");
  revalidatePath("/resources");
  return { ok: true };
}
