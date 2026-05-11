"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cloudAccounts, cachedResources, auditLog } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import {
  EC2Client,
  RevokeSecurityGroupIngressCommand,
} from "@aws-sdk/client-ec2";
import { revalidatePath } from "next/cache";

/**
 * Best-effort auto-fix actions for compliance findings. Currently AWS-only;
 * we revoke the offending ingress rule on the security group.
 */

const revokeSchema = z.object({
  accountId: z.string().min(1),
  groupId: z.string().min(1),
  port: z.number().int().min(0).max(65535),
});

interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

async function loadAwsCreds(accountId: string): Promise<{ region: string; creds: AwsCreds } | null> {
  const rows = await db.select().from(cloudAccounts).where(eq(cloudAccounts.id, accountId)).limit(1);
  const row = rows[0];
  if (!row || row.provider !== "aws") return null;
  try {
    const c = decryptJSON<AwsCreds & { defaultRegion?: string }>(row.credentialsEnc);
    return c.accessKeyId && c.secretAccessKey
      ? {
          region: c.defaultRegion ?? row.defaultRegion ?? "us-east-1",
          creds: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, sessionToken: c.sessionToken },
        }
      : null;
  } catch {
    return null;
  }
}

export async function revokeOpenWorldRuleAction(input: z.infer<typeof revokeSchema>) {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };

  const sgRows = await db.select().from(cachedResources).where(eq(cachedResources.externalId, parsed.data.groupId));
  const sg = sgRows[0];
  if (!sg) return { ok: false as const, error: "Security group not found in cache." };

  const ctx = await loadAwsCreds(parsed.data.accountId);
  if (!ctx) return { ok: false as const, error: "Could not load AWS credentials." };

  const ec2 = new EC2Client({ region: sg.region, credentials: ctx.creds });
  try {
    await ec2.send(
      new RevokeSecurityGroupIngressCommand({
        GroupId: parsed.data.groupId,
        IpPermissions: [
          {
            IpProtocol: "tcp",
            FromPort: parsed.data.port,
            ToPort: parsed.data.port,
            IpRanges: [{ CidrIp: "0.0.0.0/0" }],
            Ipv6Ranges: [{ CidrIpv6: "::/0" }],
          },
        ],
      }),
    );
    await db.insert(auditLog).values({
      accountId: parsed.data.accountId,
      action: "compliance.revoke",
      target: parsed.data.groupId,
      status: "ok",
      message: `Revoked 0.0.0.0/0:${parsed.data.port}`,
    });
    revalidatePath("/compliance");
    return { ok: true as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to revoke rule";
    await db.insert(auditLog).values({
      accountId: parsed.data.accountId,
      action: "compliance.revoke",
      target: parsed.data.groupId,
      status: "error",
      message,
    });
    return { ok: false as const, error: message };
  }
}
