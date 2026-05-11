"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { instances, cloudAccounts, auditLog } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import {
  EC2Client,
  CreateImageCommand,
  CopyImageCommand,
  DescribeImagesCommand,
  RunInstancesCommand,
} from "@aws-sdk/client-ec2";

/**
 * AWS-only cross-account / cross-region VM copy via AMI.
 *
 *   1. Source account: CreateImage from the running/stopped instance.
 *   2. (Optional) CopyImage into the target region.
 *   3. Target account: RunInstances using the new AMI id.
 *
 * Caveats:
 *  - AMIs are *account-scoped*. To share across accounts the user must run
 *    ModifyImageAttribute --launch-permission --user-ids <target> in their
 *    own AWS console. This action stops at step 2 and surfaces the AMI id +
 *    instructions; the cross-account RunInstances step is intentionally
 *    out-of-scope to avoid silent IAM grants.
 */

const copySchema = z.object({
  sourceInstanceId: z.string().min(1),
  targetRegion: z.string().min(1).max(32),
  newName: z.string().min(1).max(120),
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

export async function snapshotInstanceForCopy(input: z.infer<typeof copySchema>) {
  const parsed = copySchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };

  const inst = (await db.select().from(instances).where(eq(instances.id, parsed.data.sourceInstanceId)).limit(1))[0];
  if (!inst) return { ok: false as const, error: "Instance not found." };
  if (inst.provider !== "aws") return { ok: false as const, error: "Cross-account copy currently supports AWS only." };

  const creds = await loadAwsCreds(inst.accountId);
  if (!creds) return { ok: false as const, error: "Missing AWS credentials." };

  const sourceEc2 = new EC2Client({ region: inst.region, credentials: creds });
  let imageId: string;
  try {
    const out = await sourceEc2.send(
      new CreateImageCommand({
        InstanceId: inst.providerInstanceId,
        Name: `${parsed.data.newName}-${Date.now()}`,
        NoReboot: true,
        Description: `vmui copy of ${inst.providerInstanceId}`,
      }),
    );
    if (!out.ImageId) throw new Error("CreateImage returned no ImageId");
    imageId = out.ImageId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "CreateImage failed";
    await db.insert(auditLog).values({
      accountId: inst.accountId,
      action: "instance.copy.create-image",
      target: inst.providerInstanceId,
      status: "error",
      message: msg,
    });
    return { ok: false as const, error: msg };
  }

  let copiedImageId = imageId;
  if (parsed.data.targetRegion !== inst.region) {
    const targetEc2 = new EC2Client({ region: parsed.data.targetRegion, credentials: creds });
    try {
      const out = await targetEc2.send(
        new CopyImageCommand({
          SourceRegion: inst.region,
          SourceImageId: imageId,
          Name: `${parsed.data.newName}-${Date.now()}`,
          Description: `vmui cross-region copy of ${inst.providerInstanceId}`,
        }),
      );
      if (!out.ImageId) throw new Error("CopyImage returned no ImageId");
      copiedImageId = out.ImageId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "CopyImage failed";
      await db.insert(auditLog).values({
        accountId: inst.accountId,
        action: "instance.copy.cross-region",
        target: imageId,
        status: "error",
        message: msg,
      });
      return { ok: false as const, error: msg };
    }
  }

  await db.insert(auditLog).values({
    accountId: inst.accountId,
    action: "instance.copy.snapshot",
    target: inst.providerInstanceId,
    status: "ok",
    message: `Created ${copiedImageId} in ${parsed.data.targetRegion}.`,
  });

  return {
    ok: true as const,
    imageId: copiedImageId,
    region: parsed.data.targetRegion,
    note:
      "AMI created. To launch in another AWS account, share it via ModifyImageAttribute --launch-permission and then create a VM there. Cross-account RunInstances is intentionally a manual step.",
  };
}

const launchSchema = z.object({
  accountId: z.string().min(1),
  region: z.string().min(1),
  imageId: z.string().min(1),
  instanceType: z.string().min(1),
  name: z.string().min(1).max(120),
});

export async function launchFromImageAction(input: z.infer<typeof launchSchema>) {
  const parsed = launchSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };

  const creds = await loadAwsCreds(parsed.data.accountId);
  if (!creds) return { ok: false as const, error: "Missing AWS credentials for target account." };

  const ec2 = new EC2Client({ region: parsed.data.region, credentials: creds });
  try {
    const out = await ec2.send(
      new DescribeImagesCommand({ ImageIds: [parsed.data.imageId] }),
    );
    if ((out.Images ?? []).length === 0) {
      return { ok: false as const, error: "Image not visible to this account. Share it first." };
    }
    const run = await ec2.send(
      new RunInstancesCommand({
        ImageId: parsed.data.imageId,
        InstanceType: parsed.data.instanceType as never,
        MinCount: 1,
        MaxCount: 1,
        TagSpecifications: [
          { ResourceType: "instance", Tags: [{ Key: "Name", Value: parsed.data.name }] },
        ],
      }),
    );
    const launched = run.Instances?.[0]?.InstanceId;
    if (!launched) throw new Error("RunInstances returned no InstanceId");
    await db.insert(auditLog).values({
      accountId: parsed.data.accountId,
      action: "instance.copy.launch",
      target: launched,
      status: "ok",
      message: `Launched ${launched} from ${parsed.data.imageId}.`,
    });
    return { ok: true as const, instanceId: launched };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "RunInstances failed";
    return { ok: false as const, error: msg };
  }
}
