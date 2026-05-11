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
 * Vultr provider — Vultr API v2.
 * Auth: Bearer Personal API Key.
 * Docs: https://www.vultr.com/api/
 */

export interface VultrCredentials {
  token: string;
  defaultRegion: string;
}

const API_BASE = "https://api.vultr.com/v2";

interface VultrInstance {
  id: string;
  label: string;
  hostname: string;
  os: string;
  status: "active" | "pending" | "suspended" | "resizing";
  power_status: "running" | "stopped" | "starting";
  server_status: "ok" | "locked" | "installingbooting" | "isomounting" | "none";
  region: string;
  plan: string;
  main_ip: string;
  internal_ip: string;
  v6_main_ip: string;
  date_created: string;
  vcpu_count: number;
  ram: number;
  disk: number;
  tags: string[];
}

const TEMPLATES: InstanceTemplate[] = [
  { id: "vultr-ubuntu-24", label: "Ubuntu 24.04 LTS", platform: "linux", description: "Canonical Ubuntu 24.04 LTS.", recommendedTypes: ["vc2-1c-1gb", "vc2-1c-2gb", "vc2-2c-4gb", "vhf-1c-2gb"] },
  { id: "vultr-ubuntu-22", label: "Ubuntu 22.04 LTS", platform: "linux", description: "Canonical Ubuntu 22.04 LTS.", recommendedTypes: ["vc2-1c-1gb", "vc2-1c-2gb", "vc2-2c-4gb"] },
  { id: "vultr-debian-12", label: "Debian 12", platform: "linux", description: "Debian 12 Bookworm.", recommendedTypes: ["vc2-1c-1gb", "vc2-1c-2gb"] },
  { id: "vultr-rocky-9", label: "Rocky Linux 9", platform: "linux", description: "Rocky Linux 9.", recommendedTypes: ["vc2-1c-2gb", "vc2-2c-4gb"] },
  { id: "vultr-fedora-40", label: "Fedora 40", platform: "linux", description: "Fedora 40.", recommendedTypes: ["vc2-1c-2gb", "vc2-2c-4gb"] },
];

// Vultr "os_id" values (subject to change — fetched dynamically in createInstance fallback).
const TEMPLATE_TO_OS_ID: Record<string, number> = {
  "vultr-ubuntu-24": 2284,
  "vultr-ubuntu-22": 1743,
  "vultr-debian-12": 2136,
  "vultr-rocky-9": 1869,
  "vultr-fedora-40": 2150,
};

function mapState(p: VultrInstance["power_status"], s: VultrInstance["status"]): NormalizedState {
  if (s === "pending") return "pending";
  if (p === "starting") return "pending";
  if (p === "running") return "running";
  if (p === "stopped") return "stopped";
  return "unknown";
}

export class VultrProvider implements CloudProvider {
  readonly id = "vultr" as const;
  private creds: VultrCredentials;

  constructor(creds: VultrCredentials) { this.creds = creds; }

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
      throw new Error(`Vultr ${res.status}: ${body.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    return await res.json() as T;
  }

  private normalize(v: VultrInstance): NormalizedInstance {
    return {
      providerInstanceId: v.id,
      name: v.label || v.hostname || v.id,
      region: v.region,
      state: mapState(v.power_status, v.status),
      instanceType: v.plan,
      platform: "linux" as const,
      publicIp: v.main_ip || null,
      publicDns: null,
      privateIp: v.internal_ip || null,
      keyName: null,
      raw: v as unknown as Record<string, unknown>,
    };
  }

  async verify(): Promise<ProviderAccountInfo> {
    const r = await this.req<{ account: { name: string; email: string } }>("/account");
    return { accountId: r.account.email, label: r.account.name || r.account.email };
  }

  async listRegions(): Promise<string[]> {
    const r = await this.req<{ regions: { id: string }[] }>("/regions");
    return r.regions.map((x) => x.id);
  }

  async listInstances(_region: string): Promise<NormalizedInstance[]> {
    const r = await this.req<{ instances: VultrInstance[] }>("/instances?per_page=200");
    return r.instances.map((v) => this.normalize(v));
  }

  async getInstance(_region: string, id: string): Promise<NormalizedInstance | null> {
    try {
      const r = await this.req<{ instance: VultrInstance }>(`/instances/${id}`);
      return this.normalize(r.instance);
    } catch { return null; }
  }

  async startInstance(_region: string, id: string): Promise<void> {
    await this.req(`/instances/${id}/start`, { method: "POST", body: "{}" });
  }
  async stopInstance(_region: string, id: string): Promise<void> {
    await this.req(`/instances/${id}/halt`, { method: "POST", body: "{}" });
  }
  async rebootInstance(_region: string, id: string): Promise<void> {
    await this.req(`/instances/${id}/reboot`, { method: "POST", body: "{}" });
  }
  async terminateInstance(_region: string, id: string): Promise<void> {
    await this.req(`/instances/${id}`, { method: "DELETE" });
  }

  async createInstance(input: CreateInstanceInput): Promise<NormalizedInstance> {
    const body: Record<string, unknown> = {
      region: input.region,
      plan: input.instanceType,
      label: input.name,
      hostname: input.name.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 63),
      os_id: TEMPLATE_TO_OS_ID[input.template] ?? 2284,
      backups: "disabled",
    };
    if (input.sshPublicKey) {
      const ssh = await this.req<{ ssh_key: { id: string } }>("/ssh-keys", {
        method: "POST",
        body: JSON.stringify({ name: `vmui-${Date.now()}`, ssh_key: input.sshPublicKey }),
      });
      body.sshkey_id = [ssh.ssh_key.id];
    }
    if (input.userData) body.user_data = Buffer.from(input.userData).toString("base64");
    if (input.fromSnapshotId) body.snapshot_id = input.fromSnapshotId;
    const r = await this.req<{ instance: VultrInstance }>("/instances", { method: "POST", body: JSON.stringify(body) });
    return this.normalize(r.instance);
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
      notes: ["Use the root password emailed by Vultr or your injected SSH key."],
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> { return TEMPLATES; }

  async applyTags(_region: string, id: string, tags: Record<string, string>): Promise<void> {
    const tagList = Object.entries(tags).map(([k, v]) => v ? `${k}:${v}` : k);
    await this.req(`/instances/${id}`, { method: "PATCH", body: JSON.stringify({ tags: tagList }) });
  }

  async createSnapshot(_region: string, id: string, label: string): Promise<{ snapshotId: string }> {
    const r = await this.req<{ snapshot: { id: string } }>("/snapshots", {
      method: "POST",
      body: JSON.stringify({ instance_id: id, description: label }),
    });
    return { snapshotId: r.snapshot.id };
  }
}
