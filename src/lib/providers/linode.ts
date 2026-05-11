import "server-only";
import type {
  CloudProvider,
  ConnectionInfo,
  CreateInstanceInput,
  InstanceTemplate,
  NormalizedInstance,
  NormalizedState,
  ProviderAccountInfo,
} from "./types";

/**
 * Linode (Akamai) provider — Linode API v4.
 * Auth: Bearer Personal Access Token.
 * VM resource: "Linode". Regions are slugs (us-east, eu-central, ap-south, …).
 */

export interface LinodeCredentials {
  token: string;
  defaultRegion: string;
}

const API_BASE = "https://api.linode.com/v4";

interface LinodeAccount { email: string; company: string; }
interface LinodeRegion { id: string; country: string; status: string; }
interface LinodeInstance {
  id: number;
  label: string;
  status: "running" | "offline" | "booting" | "rebooting" | "shutting_down" | "provisioning" | "deleting" | "migrating" | "rebuilding" | "cloning" | "restoring" | "stopped";
  region: string;
  type: string;
  image: string | null;
  ipv4: string[];
  ipv6: string | null;
  created: string;
  specs: { vcpus: number; memory: number; disk: number; transfer: number; gpus: number };
  tags: string[];
}

const TEMPLATES: InstanceTemplate[] = [
  { id: "linode-ubuntu-24-04", label: "Ubuntu 24.04 LTS", platform: "linux", description: "Canonical Ubuntu 24.04 LTS (Noble).", recommendedTypes: ["g6-nanode-1", "g6-standard-1", "g6-standard-2", "g6-dedicated-2"] },
  { id: "linode-ubuntu-22-04", label: "Ubuntu 22.04 LTS", platform: "linux", description: "Canonical Ubuntu 22.04 LTS.", recommendedTypes: ["g6-nanode-1", "g6-standard-1", "g6-standard-2"] },
  { id: "linode-debian-12", label: "Debian 12", platform: "linux", description: "Debian 12 (Bookworm).", recommendedTypes: ["g6-nanode-1", "g6-standard-1"] },
  { id: "linode-rocky-9", label: "Rocky Linux 9", platform: "linux", description: "Rocky Linux 9.", recommendedTypes: ["g6-standard-1", "g6-standard-2"] },
  { id: "linode-alpine-3", label: "Alpine Linux 3", platform: "linux", description: "Alpine Linux 3.x.", recommendedTypes: ["g6-nanode-1"] },
];

const TEMPLATE_TO_IMAGE: Record<string, string> = {
  "linode-ubuntu-24-04": "linode/ubuntu24.04",
  "linode-ubuntu-22-04": "linode/ubuntu22.04",
  "linode-debian-12": "linode/debian12",
  "linode-rocky-9": "linode/rocky9",
  "linode-alpine-3": "linode/alpine3.19",
};

function mapState(s: LinodeInstance["status"]): NormalizedState {
  switch (s) {
    case "running": return "running";
    case "offline": case "stopped": return "stopped";
    case "shutting_down": return "stopping";
    case "booting": case "rebooting": case "provisioning": case "rebuilding": case "cloning": case "restoring": case "migrating": return "pending";
    case "deleting": return "terminated";
    default: return "unknown";
  }
}

export class LinodeProvider implements CloudProvider {
  readonly id = "linode" as const;
  private creds: LinodeCredentials;

  constructor(creds: LinodeCredentials) { this.creds = creds; }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "authorization": `Bearer ${this.creds.token}`,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Linode ${res.status}: ${body.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    return await res.json() as T;
  }

  private normalize(l: LinodeInstance): NormalizedInstance {
    const publicIp = l.ipv4.find((ip) => !ip.startsWith("192.168.") && !ip.startsWith("10.") && !ip.startsWith("172.")) ?? null;
    const privateIp = l.ipv4.find((ip) => ip.startsWith("192.168.") || ip.startsWith("10.")) ?? null;
    return {
      providerInstanceId: String(l.id),
      name: l.label,
      region: l.region,
      state: mapState(l.status),
      instanceType: l.type,
      platform: "linux" as const,
      publicIp,
      publicDns: null,
      privateIp,
      keyName: null,
      raw: l as unknown as Record<string, unknown>,
    };
  }

  async verify(): Promise<ProviderAccountInfo> {
    const acc = await this.req<LinodeAccount>("/account");
    return { accountId: acc.email, label: acc.company || acc.email };
  }

  async listRegions(): Promise<string[]> {
    const r = await this.req<{ data: LinodeRegion[] }>("/regions");
    return r.data.filter((x) => x.status === "ok").map((x) => x.id);
  }

  async listInstances(_region: string): Promise<NormalizedInstance[]> {
    const r = await this.req<{ data: LinodeInstance[] }>("/linode/instances?page_size=100");
    return r.data.map((l) => this.normalize(l));
  }

  async getInstance(_region: string, id: string): Promise<NormalizedInstance | null> {
    try {
      const l = await this.req<LinodeInstance>(`/linode/instances/${id}`);
      return this.normalize(l);
    } catch { return null; }
  }

  async startInstance(_region: string, id: string): Promise<void> {
    await this.req(`/linode/instances/${id}/boot`, { method: "POST", body: "{}" });
  }
  async stopInstance(_region: string, id: string): Promise<void> {
    await this.req(`/linode/instances/${id}/shutdown`, { method: "POST", body: "{}" });
  }
  async rebootInstance(_region: string, id: string): Promise<void> {
    await this.req(`/linode/instances/${id}/reboot`, { method: "POST", body: "{}" });
  }
  async terminateInstance(_region: string, id: string): Promise<void> {
    await this.req(`/linode/instances/${id}`, { method: "DELETE" });
  }

  async createInstance(input: CreateInstanceInput): Promise<NormalizedInstance> {
    const image = TEMPLATE_TO_IMAGE[input.template] ?? input.template;
    const body: Record<string, unknown> = {
      type: input.instanceType,
      region: input.region,
      label: input.name,
      image,
      root_pass: input.password ?? this.randomPassword(),
    };
    if (input.sshPublicKey) body.authorized_keys = [input.sshPublicKey];
    if (input.userData) body.metadata = { user_data: Buffer.from(input.userData).toString("base64") };
    if (input.fromSnapshotId) body.backup_id = Number(input.fromSnapshotId);
    const l = await this.req<LinodeInstance>("/linode/instances", { method: "POST", body: JSON.stringify(body) });
    return this.normalize(l);
  }

  private randomPassword(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    let out = "";
    for (let i = 0; i < 20; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  async getConnectionInfo(region: string, id: string): Promise<ConnectionInfo> {
    const inst = await this.getInstance(region, id);
    if (!inst || !inst.publicIp) {
      return { protocol: "ssh", host: "", port: 22, username: "root", notes: ["Instance has no public IP yet."] };
    }
    return {
      protocol: "ssh",
      host: inst.publicIp,
      port: 22,
      username: "root",
      sshCommand: `ssh root@${inst.publicIp}`,
      notes: ["Use the root password set at creation or your injected SSH key."],
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> { return TEMPLATES; }

  async applyTags(_region: string, id: string, tags: Record<string, string>): Promise<void> {
    const tagList = Object.entries(tags).map(([k, v]) => v ? `${k}:${v}` : k);
    await this.req(`/linode/instances/${id}`, { method: "PUT", body: JSON.stringify({ tags: tagList }) });
  }

  async createSnapshot(_region: string, id: string, label: string): Promise<{ snapshotId: string }> {
    const r = await this.req<{ id: number }>(`/linode/instances/${id}/backups`, { method: "POST", body: JSON.stringify({ label }) });
    return { snapshotId: String(r.id) };
  }
}
