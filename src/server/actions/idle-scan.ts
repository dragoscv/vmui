"use server";

import "server-only";
import { db } from "@/lib/db";
import { cloudAccounts, instances } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { CloudWatchClient, GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";

interface IdleHint {
  instanceId: string;
  providerInstanceId: string;
  name: string;
  averageCpuPct: number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * Scan AWS-only running instances and flag those with average CPU < 5% over
 * the last 7 days. Best-effort: any provider error skips that instance.
 * Result is intended to be rendered on /costs as suggestions.
 */
export async function findIdleAwsInstances(): Promise<IdleHint[]> {
  const accs = await db.select().from(cloudAccounts);
  const insts = await db.select().from(instances);
  const out: IdleHint[] = [];

  for (const acc of accs) {
    if (acc.provider !== "aws") continue;
    let creds: AwsCreds | null = null;
    try {
      const c = decryptJSON<AwsCreds>(acc.credentialsEnc);
      if (c.accessKeyId && c.secretAccessKey) creds = c;
    } catch {
      continue;
    }
    if (!creds) continue;

    for (const inst of insts) {
      if (inst.accountId !== acc.id) continue;
      if (inst.provider !== "aws") continue;
      if (inst.state !== "running") continue;

      const cw = new CloudWatchClient({ region: inst.region, credentials: creds });
      try {
        const out2 = await cw.send(
          new GetMetricStatisticsCommand({
            Namespace: "AWS/EC2",
            MetricName: "CPUUtilization",
            Dimensions: [{ Name: "InstanceId", Value: inst.providerInstanceId }],
            StartTime: new Date(Date.now() - SEVEN_DAYS_MS),
            EndTime: new Date(),
            Period: 3600,
            Statistics: ["Average"],
          }),
        );
        const points = out2.Datapoints ?? [];
        if (points.length < 12) continue; // need ~half a day of points
        const avg = points.reduce((s, p) => s + (p.Average ?? 0), 0) / points.length;
        if (avg < 5) {
          out.push({
            instanceId: inst.id,
            providerInstanceId: inst.providerInstanceId,
            name: inst.displayName ?? inst.name ?? inst.providerInstanceId,
            averageCpuPct: Math.round(avg * 10) / 10,
          });
        }
      } catch {
        // Skip instances we can't query.
      }
    }
  }

  out.sort((a, b) => a.averageCpuPct - b.averageCpuPct);
  return out;
}
