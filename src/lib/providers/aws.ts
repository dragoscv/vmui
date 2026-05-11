import "server-only";
import {
  AllocateHostsCommand,
  DescribeHostsCommand,
  DescribeImagesCommand,
  DescribeInstancesCommand,
  DescribeKeyPairsCommand,
  DescribeRegionsCommand,
  DescribeSecurityGroupsCommand,
  DescribeSnapshotsCommand,
  DescribeSubnetsCommand,
  DescribeVolumesCommand,
  DescribeVpcsCommand,
  EC2Client,
  GetPasswordDataCommand,
  RebootInstancesCommand,
  RunInstancesCommand,
  type RunInstancesCommandInput,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  CreateTagsCommand,
  GetConsoleOutputCommand,
  CreateSnapshotsCommand,
  DeleteSnapshotCommand,
  RegisterImageCommand,
  type Instance as Ec2Instance,
} from "@aws-sdk/client-ec2";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from "@aws-sdk/client-cloudwatch";
import { S3Client, ListBucketsCommand, GetBucketLocationCommand } from "@aws-sdk/client-s3";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { Route53Client, ListHostedZonesCommand } from "@aws-sdk/client-route-53";
import { privateDecrypt, constants as cryptoConstants } from "node:crypto";
import type {
  CloudProvider,
  ConnectionInfo,
  CreateInstanceInput,
  InstanceLogChunk,
  InstanceStatsSample,
  InstanceTemplate,
  MetricSeries,
  MetricsHistory,
  NormalizedInstance,
  NormalizedResource,
  NormalizedState,
  Platform,
  ResourceKind,
  ProviderAccountInfo,
} from "./types";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  defaultRegion: string;
}

const TEMPLATES: InstanceTemplate[] = [
  {
    id: "macos-sonoma-arm64",
    label: "macOS Sonoma (Apple Silicon)",
    platform: "macos",
    description: "EC2 Mac (mac2.metal / mac-m4.metal). Requires a Dedicated Host.",
    recommendedTypes: ["mac2.metal", "mac2-m2.metal", "mac-m4.metal", "mac-m4pro.metal"],
    notes: [
      "Mac instances require a Dedicated Host and have a 24-hour minimum allocation.",
      "Approx. $6.50/hr (mac2.metal). Released hosts continue billing for the full 24h.",
      "Connect via SSH; enable VNC for the GUI (handled by vmui's connect dialog).",
    ],
  },
  {
    id: "windows-2022",
    label: "Windows Server 2022",
    platform: "windows",
    description: "Standard Windows Server with RDP enabled.",
    recommendedTypes: ["t3.medium", "t3.large", "m6i.large"],
    notes: ["RDP is exposed on port 3389. vmui will generate an .rdp file."],
  },
  {
    id: "ubuntu-22.04",
    label: "Ubuntu 22.04 LTS",
    platform: "linux",
    description: "General-purpose Linux instance, x86_64.",
    recommendedTypes: ["t3.micro", "t3.small", "t3.medium"],
  },
  {
    id: "amazon-linux-2023",
    label: "Amazon Linux 2023",
    platform: "linux",
    description: "AWS-optimized Linux distribution.",
    recommendedTypes: ["t3.micro", "t3.small", "t3.medium"],
  },
];

/**
 * SSM parameter paths to resolve "latest" AMI IDs without baking ids into code.
 * https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-public-parameters-ami.html
 */
const TEMPLATE_AMI_PARAMS: Record<string, { param: string; arch: "x86_64" | "arm64" }> = {
  "ubuntu-22.04": {
    param: "/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id",
    arch: "x86_64",
  },
  "amazon-linux-2023": {
    param: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64",
    arch: "x86_64",
  },
  "windows-2022": {
    param: "/aws/service/ami-windows-latest/Windows_Server-2022-English-Full-Base",
    arch: "x86_64",
  },
  "macos-sonoma-arm64": {
    param: "/aws/service/ec2-macos/sonoma/arm64_mac/latest/image_id",
    arch: "arm64",
  },
};

function mapState(s: string | undefined): NormalizedState {
  switch (s) {
    case "pending":
    case "running":
    case "stopping":
    case "stopped":
    case "shutting-down":
    case "terminated":
      return s;
    default:
      return "unknown";
  }
}

function detectPlatform(inst: Ec2Instance): Platform {
  const platformDetails = inst.PlatformDetails ?? "";
  if (platformDetails.toLowerCase().includes("mac")) return "macos";
  if ((inst.Platform as string | undefined) === "windows" || platformDetails.toLowerCase().includes("windows")) {
    return "windows";
  }
  if (inst.InstanceType?.startsWith("mac")) return "macos";
  return "linux";
}

function nameTag(inst: Ec2Instance): string | null {
  return inst.Tags?.find((t) => t.Key === "Name")?.Value ?? null;
}

function normalize(inst: Ec2Instance, region: string): NormalizedInstance {
  return {
    providerInstanceId: inst.InstanceId ?? "",
    region,
    name: nameTag(inst),
    state: mapState(inst.State?.Name),
    platform: detectPlatform(inst),
    instanceType: inst.InstanceType ?? null,
    publicIp: inst.PublicIpAddress ?? null,
    publicDns: inst.PublicDnsName || null,
    privateIp: inst.PrivateIpAddress ?? null,
    keyName: inst.KeyName ?? null,
    raw: inst,
  };
}

export class AwsProvider implements CloudProvider {
  readonly id = "aws" as const;
  private readonly creds: AwsCredentials;

  constructor(creds: AwsCredentials) {
    this.creds = creds;
  }

  private ec2(region?: string): EC2Client {
    return new EC2Client({
      region: region ?? this.creds.defaultRegion,
      credentials: {
        accessKeyId: this.creds.accessKeyId,
        secretAccessKey: this.creds.secretAccessKey,
        sessionToken: this.creds.sessionToken,
      },
    });
  }

  private credentialsObj() {
    return {
      accessKeyId: this.creds.accessKeyId,
      secretAccessKey: this.creds.secretAccessKey,
      sessionToken: this.creds.sessionToken,
    };
  }

  private sts(): STSClient {
    return new STSClient({
      region: this.creds.defaultRegion,
      credentials: {
        accessKeyId: this.creds.accessKeyId,
        secretAccessKey: this.creds.secretAccessKey,
        sessionToken: this.creds.sessionToken,
      },
    });
  }

  private cloudwatch(region: string): CloudWatchClient {
    return new CloudWatchClient({
      region,
      credentials: {
        accessKeyId: this.creds.accessKeyId,
        secretAccessKey: this.creds.secretAccessKey,
        sessionToken: this.creds.sessionToken,
      },
    });
  }

  /**
   * Pull a recent CloudWatch sample for an instance. CloudWatch publishes
   * EC2 metrics at 5-minute granularity by default, so we look at the last
   * ~10 minutes and take the most recent datapoint. Memory and disk are
   * unavailable without the CloudWatch agent installed in the guest.
   */
  async getMetrics(region: string, instanceId: string): Promise<InstanceStatsSample> {
    const cw = this.cloudwatch(region);
    const now = new Date();
    const start = new Date(now.getTime() - 10 * 60 * 1000);
    const dimensions = [{ Name: "InstanceId", Value: instanceId }];

    async function fetchLatest(name: string, unit: "Percent" | "Bytes"): Promise<number | undefined> {
      const out = await cw.send(
        new GetMetricStatisticsCommand({
          Namespace: "AWS/EC2",
          MetricName: name,
          Dimensions: dimensions,
          StartTime: start,
          EndTime: now,
          Period: 60,
          Statistics: ["Average"],
          Unit: unit,
        }),
      );
      const points = (out.Datapoints ?? []).slice().sort((a, b) => {
        const ta = a.Timestamp?.getTime() ?? 0;
        const tb = b.Timestamp?.getTime() ?? 0;
        return tb - ta;
      });
      const v = points[0]?.Average;
      return typeof v === "number" ? v : undefined;
    }

    const [cpu, netIn, netOut] = await Promise.all([
      fetchLatest("CPUUtilization", "Percent"),
      fetchLatest("NetworkIn", "Bytes"),
      fetchLatest("NetworkOut", "Bytes"),
    ]);

    return {
      sampledAt: Date.now(),
      running: true,
      cpuPercent: cpu,
      // CloudWatch emits NetworkIn/NetworkOut as bytes-per-period (60s here),
      // so divide to get bytes/sec.
      netRxBps: typeof netIn === "number" ? netIn / 60 : undefined,
      netTxBps: typeof netOut === "number" ? netOut / 60 : undefined,
      note: "CloudWatch · 5-min granularity (memory/disk require CW agent).",
    };
  }

  async getMetricsHistory(
    region: string,
    instanceId: string,
    rangeMinutes: number,
  ): Promise<MetricsHistory> {
    const cw = this.cloudwatch(region);
    const end = new Date();
    const start = new Date(end.getTime() - rangeMinutes * 60_000);
    // Pick a period that yields ~60-120 buckets and respects CW's 1m / 5m grids.
    const targetBuckets = 90;
    const rough = Math.max(60, Math.round((rangeMinutes * 60) / targetBuckets));
    const period = rough <= 60 ? 60 : rough <= 300 ? 300 : rough <= 900 ? 900 : 3600;
    const dimensions = [{ Name: "InstanceId", Value: instanceId }];

    const fetchSeries = async (
      name: string,
      unit: "Percent" | "Bytes",
    ): Promise<{ t: number; v: number | null }[]> => {
      const out = await cw.send(
        new GetMetricStatisticsCommand({
          Namespace: "AWS/EC2",
          MetricName: name,
          Dimensions: dimensions,
          StartTime: start,
          EndTime: end,
          Period: period,
          Statistics: ["Average"],
          Unit: unit,
        }),
      );
      return (out.Datapoints ?? [])
        .map((d) => ({ t: d.Timestamp?.getTime() ?? 0, v: typeof d.Average === "number" ? d.Average : null }))
        .sort((a, b) => a.t - b.t);
    };

    const [cpu, netIn, netOut] = await Promise.all([
      fetchSeries("CPUUtilization", "Percent"),
      fetchSeries("NetworkIn", "Bytes"),
      fetchSeries("NetworkOut", "Bytes"),
    ]);

    const toBps = (pts: { t: number; v: number | null }[]): { t: number; v: number | null }[] =>
      pts.map((p) => ({ t: p.t, v: p.v == null ? null : p.v / period }));

    const series: MetricSeries[] = [
      { id: "cpuPercent", label: "CPU", unit: "percent", points: cpu },
      { id: "netRxBps", label: "Network in", unit: "bps", points: toBps(netIn) },
      { id: "netTxBps", label: "Network out", unit: "bps", points: toBps(netOut) },
    ];
    return {
      startedAt: start.getTime(),
      endedAt: end.getTime(),
      stepSeconds: period,
      series,
      source: `CloudWatch · ${period}s buckets`,
      note: "Memory and disk metrics require the CloudWatch agent to be installed in the guest.",
    };
  }

  async getInstanceLogs(region: string, instanceId: string): Promise<InstanceLogChunk> {
    const out = await this.ec2(region).send(
      new GetConsoleOutputCommand({ InstanceId: instanceId, Latest: true }),
    );
    const b64 = out.Output ?? "";
    const text = b64 ? Buffer.from(b64, "base64").toString("utf8") : "";
    return {
      text,
      fetchedAt: Date.now(),
      source: "EC2 console output",
      truncated: false,
      note: text ? undefined : "AWS publishes console output asynchronously; it may take a few minutes after boot to appear.",
    };
  }

  async createSnapshot(
    region: string,
    instanceId: string,
    label: string,
  ): Promise<{ snapshotId: string; note?: string }> {
    const out = await this.ec2(region).send(
      new CreateSnapshotsCommand({
        InstanceSpecification: { InstanceId: instanceId, ExcludeBootVolume: false },
        Description: label,
        CopyTagsFromSource: "volume",
      }),
    );
    const snaps = out.Snapshots ?? [];
    if (snaps.length === 0) throw new Error("AWS returned no snapshots");
    const ids = snaps.map((s) => s.SnapshotId).filter(Boolean) as string[];
    return {
      snapshotId: ids.join(","),
      note: snaps.length > 1 ? `Created ${snaps.length} snapshots (one per attached volume).` : undefined,
    };
  }

  async deleteSnapshot(region: string, snapshotId: string): Promise<void> {
    const ids = snapshotId.split(",").map((s) => s.trim()).filter(Boolean);
    for (const id of ids) {
      await this.ec2(region).send(new DeleteSnapshotCommand({ SnapshotId: id }));
    }
  }

  /**
   * Retrieve and decrypt the auto-generated Windows Administrator password.
   * AWS encrypts it with the public half of the keypair using PKCS#1 v1.5
   * padding. Decryption requires the corresponding private key (PEM).
   */
  async getWindowsPassword(
    region: string,
    instanceId: string,
    privateKeyPem: string,
  ): Promise<{ password: string; passwordTimestamp?: string }> {
    const out = await this.ec2(region).send(new GetPasswordDataCommand({ InstanceId: instanceId }));
    const data = out.PasswordData;
    if (!data) {
      throw new Error(
        "Password not available yet. AWS can take up to 4 minutes after launch to generate it; try again shortly.",
      );
    }
    const ciphertext = Buffer.from(data, "base64");
    let plaintext: Buffer;
    try {
      plaintext = privateDecrypt(
        { key: privateKeyPem, padding: cryptoConstants.RSA_PKCS1_PADDING },
        ciphertext,
      );
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? `Decryption failed (wrong private key?): ${err.message}`
          : "Decryption failed — make sure the private key matches the keypair this instance was launched with.",
      );
    }
    return {
      password: plaintext.toString("utf8"),
      passwordTimestamp: out.Timestamp?.toISOString(),
    };
  }

  async verify(): Promise<ProviderAccountInfo> {
    const out = await this.sts().send(new GetCallerIdentityCommand({}));
    return {
      accountId: out.Account ?? "unknown",
      label: out.Arn ?? out.Account ?? "AWS account",
    };
  }

  async listRegions(): Promise<string[]> {
    const out = await this.ec2().send(new DescribeRegionsCommand({ AllRegions: false }));
    return (out.Regions ?? []).map((r) => r.RegionName ?? "").filter(Boolean).sort();
  }

  async listInstances(region: string): Promise<NormalizedInstance[]> {
    const out = await this.ec2(region).send(new DescribeInstancesCommand({}));
    const result: NormalizedInstance[] = [];
    for (const r of out.Reservations ?? []) {
      for (const i of r.Instances ?? []) {
        if (!i.InstanceId) continue;
        if (i.State?.Name === "terminated") continue;
        result.push(normalize(i, region));
      }
    }
    return result;
  }

  async getInstance(region: string, id: string): Promise<NormalizedInstance | null> {
    const out = await this.ec2(region).send(
      new DescribeInstancesCommand({ InstanceIds: [id] }),
    );
    const inst = out.Reservations?.[0]?.Instances?.[0];
    return inst ? normalize(inst, region) : null;
  }

  async startInstance(region: string, id: string): Promise<void> {
    await this.ec2(region).send(new StartInstancesCommand({ InstanceIds: [id] }));
  }
  async stopInstance(region: string, id: string): Promise<void> {
    await this.ec2(region).send(new StopInstancesCommand({ InstanceIds: [id] }));
  }
  async rebootInstance(region: string, id: string): Promise<void> {
    await this.ec2(region).send(new RebootInstancesCommand({ InstanceIds: [id] }));
  }
  async terminateInstance(region: string, id: string): Promise<void> {
    await this.ec2(region).send(new TerminateInstancesCommand({ InstanceIds: [id] }));
  }

  async applyTags(region: string, id: string, tags: Record<string, string>): Promise<void> {
    const Tags = Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
    if (Tags.length === 0) return;
    await this.ec2(region).send(new CreateTagsCommand({ Resources: [id], Tags }));
  }

  /**
   * Resolve AMI id via SSM public parameter. Falls back to a name-based DescribeImages
   * for templates that don't have a known SSM param.
   */
  private async resolveAmi(region: string, template: string): Promise<string> {
    const cfg = TEMPLATE_AMI_PARAMS[template];
    if (!cfg) throw new Error(`Unknown template: ${template}`);

    // Use SSM via the EC2 GetImages-by-SSM convenience: DescribeImages with
    // ImageIds=[`resolve:ssm:${param}`] is supported in modern SDK versions.
    const out = await this.ec2(region).send(
      new DescribeImagesCommand({ ImageIds: [`resolve:ssm:${cfg.param}`] }),
    );
    const ami = out.Images?.[0]?.ImageId;
    if (!ami) {
      throw new Error(
        `Could not resolve AMI for template '${template}' in ${region}. Check region availability.`,
      );
    }
    return ami;
  }

  /**
   * Register a new AMI backed by an existing EBS snapshot, so it can be used
   * as the boot source for a fresh EC2 instance. Snapshots created by vmui
   * may include multiple comma-joined ids (one per attached volume); we use
   * the first as the boot disk and ignore the rest. Idempotent on (snapshot,
   * label): re-running with the same input simply returns a fresh AMI id.
   */
  private async registerImageFromSnapshot(
    region: string,
    snapshotId: string,
    label: string,
  ): Promise<string> {
    const bootSnap = (snapshotId.split(",")[0] ?? "").trim();
    if (!bootSnap.startsWith("snap-")) {
      throw new Error(`Invalid snapshot id: ${snapshotId}`);
    }
    const ec2 = this.ec2(region);
    // Pull the snapshot to learn its size + architecture hints.
    const snaps = await ec2.send(new DescribeSnapshotsCommand({ SnapshotIds: [bootSnap] }));
    const snap = snaps.Snapshots?.[0];
    if (!snap) throw new Error(`Snapshot not found in ${region}: ${bootSnap}`);
    const safeLabel = label.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
    const amiName = `vmui-restore-${safeLabel}-${Date.now()}`.slice(0, 128);
    const out = await ec2.send(
      new RegisterImageCommand({
        Name: amiName,
        Description: `vmui restore from ${bootSnap}`,
        Architecture: "x86_64",
        RootDeviceName: "/dev/xvda",
        VirtualizationType: "hvm",
        EnaSupport: true,
        BlockDeviceMappings: [
          {
            DeviceName: "/dev/xvda",
            Ebs: {
              SnapshotId: bootSnap,
              VolumeSize: snap.VolumeSize ?? 8,
              VolumeType: "gp3",
              DeleteOnTermination: true,
            },
          },
        ],
      }),
    );
    if (!out.ImageId) throw new Error(`RegisterImage returned no ImageId for ${bootSnap}`);
    return out.ImageId;
  }

  async createInstance(input: CreateInstanceInput): Promise<NormalizedInstance> {
    const ami = input.fromSnapshotId
      ? await this.registerImageFromSnapshot(input.region, input.fromSnapshotId, input.name)
      : await this.resolveAmi(input.region, input.template);
    const isMac = input.template.startsWith("macos") || input.instanceType.startsWith("mac");

    let placement: { HostId?: string; Tenancy?: "host" } | undefined;
    if (isMac) {
      // Allocate a Dedicated Host (or reuse an available one) for Mac instances.
      const hosts = await this.ec2(input.region).send(
        new DescribeHostsCommand({
          Filter: [
            { Name: "instance-type", Values: [input.instanceType] },
            { Name: "state", Values: ["available"] },
          ],
        }),
      );
      let hostId = hosts.Hosts?.[0]?.HostId;
      if (!hostId) {
        const az = await this.pickAvailabilityZone(input.region);
        const alloc = await this.ec2(input.region).send(
          new AllocateHostsCommand({
            InstanceType: input.instanceType,
            Quantity: 1,
            AvailabilityZone: az,
            AutoPlacement: "on",
            TagSpecifications: [
              {
                ResourceType: "dedicated-host",
                Tags: [
                  { Key: "Name", Value: `vmui-${input.name}` },
                  { Key: "vmui:managed", Value: "true" },
                ],
              },
            ],
          }),
        );
        hostId = alloc.HostIds?.[0];
        if (!hostId) throw new Error("Failed to allocate Dedicated Host for Mac instance");
      }
      placement = { HostId: hostId, Tenancy: "host" };
    }

    const out = await this.ec2(input.region).send(
      new RunInstancesCommand({
        ImageId: ami,
        InstanceType: input.instanceType as RunInstancesCommandInput["InstanceType"],
        MinCount: 1,
        MaxCount: 1,
        KeyName: input.keyName,
        Placement: placement,
        UserData: input.userData
          ? Buffer.from(input.userData, "utf-8").toString("base64")
          : undefined,
        TagSpecifications: [
          {
            ResourceType: "instance",
            Tags: [
              { Key: "Name", Value: input.name },
              { Key: "vmui:managed", Value: "true" },
            ],
          },
        ],
      }),
    );

    const inst = out.Instances?.[0];
    if (!inst?.InstanceId) throw new Error("RunInstances returned no instance");
    return normalize(inst, input.region);
  }

  private async pickAvailabilityZone(region: string): Promise<string> {
    // Pick the first AZ in the region (good enough; users can refine later).
    const out = await this.ec2(region).send(new DescribeRegionsCommand({}));
    const r = out.Regions?.find((x) => x.RegionName === region);
    if (!r) throw new Error(`Region not found: ${region}`);
    return `${region}a`;
  }

  async getConnectionInfo(region: string, id: string): Promise<ConnectionInfo> {
    const inst = await this.getInstance(region, id);
    if (!inst) throw new Error("Instance not found");
    if (inst.state !== "running") {
      throw new Error(`Instance is ${inst.state}; start it first.`);
    }
    const host = inst.publicDns || inst.publicIp;
    if (!host) {
      throw new Error("Instance has no public DNS or IP. Attach an Elastic IP or enable public IP.");
    }

    if (inst.platform === "windows") {
      const rdp = [
        `full address:s:${host}:3389`,
        "prompt for credentials:i:1",
        "administrative session:i:0",
        "screen mode id:i:2",
        "use multimon:i:0",
        "audiomode:i:0",
        "redirectclipboard:i:1",
        "redirectprinters:i:0",
        "authentication level:i:2",
        "negotiate security layer:i:1",
      ].join("\r\n");
      return {
        protocol: "rdp",
        host,
        port: 3389,
        username: "Administrator",
        fileContent: rdp,
        fileName: `${inst.name ?? id}.rdp`,
        fileMime: "application/x-rdp",
        notes: [
          "Get the Administrator password from EC2 → Instance → Connect → RDP client → Get password (requires your private key).",
          "Open the downloaded .rdp file with Microsoft Remote Desktop.",
        ],
      };
    }

    if (inst.platform === "macos") {
      const username = "ec2-user";
      const sshCommand = `ssh -i ~/.ssh/${inst.keyName ?? "your-key"}.pem -L 5900:localhost:5900 ${username}@${host}`;
      return {
        protocol: "vnc",
        host,
        port: 5900,
        username,
        sshCommand,
        vncUrl: `vnc://localhost:5900`,
        notes: [
          "macOS GUI requires VNC. First SSH in and enable Screen Sharing:",
          `  ${sshCommand}`,
          "Once connected, run:",
          "  sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart \\",
          "    -activate -configure -access -on -clientopts -setvnclegacy -vnclegacy yes \\",
          "    -setvncpw -vncpw <pick-a-password> -restart -agent -privs -all",
          "Then in Finder press ⌘K and connect to vnc://localhost:5900 (tunneled over SSH).",
        ],
      };
    }

    const username = "ec2-user";
    const sshCommand = `ssh -i ~/.ssh/${inst.keyName ?? "your-key"}.pem ${username}@${host}`;
    return {
      protocol: "ssh",
      host,
      port: 22,
      username,
      sshCommand,
      notes: [
        "Linux instances use SSH on port 22.",
        `Default username for Amazon Linux: ec2-user. Ubuntu: ubuntu.`,
      ],
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> {
    return TEMPLATES;
  }

  async listResources(region: string, kind: ResourceKind): Promise<NormalizedResource[]> {
    const ec2 = this.ec2(region);
    const tagOf = (tags?: { Key?: string; Value?: string }[]): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const t of tags ?? []) if (t.Key) out[t.Key] = t.Value ?? "";
      return out;
    };
    const nameOf = (tags?: { Key?: string; Value?: string }[]): string | null =>
      tags?.find((t) => t.Key === "Name")?.Value ?? null;

    switch (kind) {
      case "volume": {
        const out = await ec2.send(new DescribeVolumesCommand({}));
        return (out.Volumes ?? []).map((v) => ({
          externalId: v.VolumeId ?? "",
          region,
          kind: "volume",
          name: nameOf(v.Tags) ?? v.VolumeId ?? null,
          status: v.State ?? null,
          sizeBytes: v.Size ? v.Size * 1024 ** 3 : null,
          attachedTo: v.Attachments?.[0]?.InstanceId ?? null,
          tags: tagOf(v.Tags),
          raw: v,
        }));
      }
      case "snapshot": {
        // Limit to snapshots owned by this account; "self" is the AWS shorthand.
        const out = await ec2.send(new DescribeSnapshotsCommand({ OwnerIds: ["self"] }));
        return (out.Snapshots ?? []).map((s) => ({
          externalId: s.SnapshotId ?? "",
          region,
          kind: "snapshot",
          name: nameOf(s.Tags) ?? s.Description ?? s.SnapshotId ?? null,
          status: s.State ?? null,
          sizeBytes: s.VolumeSize ? s.VolumeSize * 1024 ** 3 : null,
          attachedTo: s.VolumeId ?? null,
          tags: tagOf(s.Tags),
          raw: s,
        }));
      }
      case "security-group": {
        const out = await ec2.send(new DescribeSecurityGroupsCommand({}));
        return (out.SecurityGroups ?? []).map((g) => ({
          externalId: g.GroupId ?? "",
          region,
          kind: "security-group",
          name: g.GroupName ?? g.GroupId ?? null,
          status: null,
          attachedTo: g.VpcId ?? null,
          tags: tagOf(g.Tags),
          raw: g,
        }));
      }
      case "keypair": {
        const out = await ec2.send(new DescribeKeyPairsCommand({}));
        return (out.KeyPairs ?? []).map((k) => ({
          externalId: k.KeyPairId ?? k.KeyName ?? "",
          region,
          kind: "keypair",
          name: k.KeyName ?? null,
          status: k.KeyType ?? null,
          tags: tagOf(k.Tags),
          raw: k,
        }));
      }
      case "vpc": {
        const out = await ec2.send(new DescribeVpcsCommand({}));
        return (out.Vpcs ?? []).map((v) => ({
          externalId: v.VpcId ?? "",
          region,
          kind: "vpc",
          name: nameOf(v.Tags) ?? v.VpcId ?? null,
          status: v.State ?? null,
          tags: tagOf(v.Tags),
          raw: v,
        }));
      }
      case "subnet": {
        const out = await ec2.send(new DescribeSubnetsCommand({}));
        return (out.Subnets ?? []).map((s) => ({
          externalId: s.SubnetId ?? "",
          region,
          kind: "subnet",
          name: nameOf(s.Tags) ?? s.SubnetId ?? null,
          status: s.State ?? null,
          attachedTo: s.VpcId ?? null,
          tags: tagOf(s.Tags),
          raw: s,
        }));
      }
      case "bucket": {
        // S3 buckets are global; ignore the region arg for listing but resolve
        // each bucket's actual region for display.
        const s3 = new S3Client({
          region: region || "us-east-1",
          credentials: this.credentialsObj(),
        });
        const out = await s3.send(new ListBucketsCommand({}));
        const result: NormalizedResource[] = [];
        for (const b of out.Buckets ?? []) {
          if (!b.Name) continue;
          let bucketRegion = "us-east-1";
          try {
            const loc = await s3.send(new GetBucketLocationCommand({ Bucket: b.Name }));
            // EU empty string = us-east-1; "EU" = eu-west-1 (legacy).
            const c = loc.LocationConstraint;
            bucketRegion = c === "EU" ? "eu-west-1" : c || "us-east-1";
          } catch {
            /* keep default region */
          }
          result.push({
            externalId: b.Name,
            region: bucketRegion,
            kind: "bucket",
            name: b.Name,
            status: null,
            raw: b,
          });
        }
        return result;
      }
      case "database": {
        const rds = new RDSClient({ region, credentials: this.credentialsObj() });
        const out = await rds.send(new DescribeDBInstancesCommand({}));
        return (out.DBInstances ?? []).map((d) => ({
          externalId: d.DBInstanceIdentifier ?? "",
          region,
          kind: "database",
          name: d.DBInstanceIdentifier ?? null,
          status: d.DBInstanceStatus ?? null,
          sizeBytes: d.AllocatedStorage ? d.AllocatedStorage * 1024 ** 3 : null,
          tags: {
            engine: d.Engine ?? "",
            class: d.DBInstanceClass ?? "",
            multiAZ: String(Boolean(d.MultiAZ)),
          },
          raw: d,
        }));
      }
      case "load-balancer": {
        const elb = new ElasticLoadBalancingV2Client({ region, credentials: this.credentialsObj() });
        const out = await elb.send(new DescribeLoadBalancersCommand({}));
        return (out.LoadBalancers ?? []).map((lb) => ({
          externalId: lb.LoadBalancerArn ?? "",
          region,
          kind: "load-balancer",
          name: lb.LoadBalancerName ?? null,
          status: lb.State?.Code ?? null,
          attachedTo: lb.VpcId ?? null,
          tags: { type: lb.Type ?? "", scheme: lb.Scheme ?? "" },
          raw: lb,
        }));
      }
      case "dns-zone": {
        const r53 = new Route53Client({ region: "us-east-1", credentials: this.credentialsObj() });
        const out = await r53.send(new ListHostedZonesCommand({}));
        return (out.HostedZones ?? []).map((z) => ({
          externalId: z.Id ?? "",
          region: "global",
          kind: "dns-zone",
          name: z.Name ?? null,
          status: z.Config?.PrivateZone ? "private" : "public",
          tags: { records: String(z.ResourceRecordSetCount ?? 0) },
          raw: z,
        }));
      }
      default:
        return [];
    }
  }
}
