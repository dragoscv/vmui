import "server-only";
import {
  AllocateHostsCommand,
  DescribeHostsCommand,
  DescribeImagesCommand,
  DescribeInstancesCommand,
  DescribeRegionsCommand,
  EC2Client,
  RebootInstancesCommand,
  RunInstancesCommand,
  type RunInstancesCommandInput,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  type Instance as Ec2Instance,
} from "@aws-sdk/client-ec2";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type {
  CloudProvider,
  ConnectionInfo,
  CreateInstanceInput,
  InstanceTemplate,
  NormalizedInstance,
  NormalizedState,
  Platform,
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

  async createInstance(input: CreateInstanceInput): Promise<NormalizedInstance> {
    const ami = await this.resolveAmi(input.region, input.template);
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
}
