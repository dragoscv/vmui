import "server-only";
import type {
  CloudProvider,
  ConnectionInfo,
  CreateInstanceInput,
  InstanceTemplate,
  NormalizedInstance,
  NormalizedResource,
  NormalizedState,
  Platform,
  ProviderAccountInfo,
  ResourceKind,
} from "./types";

/**
 * DigitalOcean provider.
 *
 * API: https://docs.digitalocean.com/reference/api/api-reference/
 * Auth: Bearer Personal Access Token (write scope required for lifecycle).
 *
 * VM resource is the "droplet". Regions are slugs (nyc3, fra1, …).
 * Sizes are slugs (s-1vcpu-1gb, c-2, g-2vcpu-8gb, …).
 */

export interface DigitalOceanCredentials {
  /** DigitalOcean Personal Access Token (or OAuth bearer). */
  token: string;
  /** Default region slug. */
  defaultRegion: string;
}

const API_BASE = "https://api.digitalocean.com/v2";

interface DoAccount {
  account: { uuid: string; email: string; team?: { uuid: string; name: string } };
}

interface DoDroplet {
  id: number;
  name: string;
  status: "new" | "active" | "off" | "archive";
  region: { slug: string; name: string };
  size_slug: string;
  image: { id: number; distribution: string; slug: string | null; name: string };
  networks: {
    v4: { ip_address: string; type: "public" | "private" }[];
    v6: { ip_address: string; type: "public" | "private" }[];
  };
  ssh_keys?: number[];
  tags: string[];
  created_at: string;
  vcpus: number;
  memory: number;
  disk: number;
}

interface DoVolume {
  id: string;
  name: string;
  region: { slug: string };
  size_gigabytes: number;
  droplet_ids: number[];
  status?: string;
  tags?: string[];
}

interface DoSnapshot {
  id: string;
  name: string;
  resource_id: string;
  resource_type: "droplet" | "volume";
  regions: string[];
  size_gigabytes: number;
  created_at: string;
  tags?: string[];
}

interface DoFirewall {
  id: string;
  name: string;
  status: string;
  droplet_ids: number[];
  tags?: string[];
}

interface DoFloatingIp {
  ip: string;
  region: { slug: string };
  droplet: DoDroplet | null;
}

interface DoVpc {
  id: string;
  name: string;
  region: string;
  ip_range: string;
}

interface DoLoadBalancer {
  id: string;
  name: string;
  status: string;
  region: { slug: string } | null;
  ip: string;
  size?: string;
}

interface DoDatabase {
  id: string;
  name: string;
  engine: string;
  version: string;
  status: string;
  region: string;
  size: string;
  tags?: string[];
}

interface DoSshKey {
  id: number;
  fingerprint: string;
  public_key: string;
  name: string;
}

interface DoSpacesKey {
  name: string;
  region?: string;
}

interface DoKubernetesCluster {
  id: string;
  name: string;
  region: string;
  status: { state: string };
  version: string;
  tags?: string[];
}

interface DoAction {
  id: number;
  status: "in-progress" | "completed" | "errored";
  type: string;
}

const TEMPLATES: InstanceTemplate[] = [
  {
    id: "do-ubuntu-22-04",
    label: "Ubuntu 22.04 LTS",
    platform: "linux",
    description: "Canonical Ubuntu 22.04 LTS, official DigitalOcean image.",
    recommendedTypes: ["s-1vcpu-1gb", "s-2vcpu-2gb", "s-2vcpu-4gb", "s-4vcpu-8gb", "c-2", "g-2vcpu-8gb"],
  },
  {
    id: "do-ubuntu-24-04",
    label: "Ubuntu 24.04 LTS",
    platform: "linux",
    description: "Canonical Ubuntu 24.04 LTS (Noble).",
    recommendedTypes: ["s-1vcpu-1gb", "s-2vcpu-2gb", "s-2vcpu-4gb", "s-4vcpu-8gb"],
  },
  {
    id: "do-debian-12",
    label: "Debian 12",
    platform: "linux",
    description: "Debian 12 (Bookworm).",
    recommendedTypes: ["s-1vcpu-1gb", "s-2vcpu-2gb", "s-2vcpu-4gb"],
  },
  {
    id: "do-rocky-9",
    label: "Rocky Linux 9",
    platform: "linux",
    description: "Rocky Linux 9 (RHEL-compatible).",
    recommendedTypes: ["s-1vcpu-2gb", "s-2vcpu-4gb"],
  },
  {
    id: "do-fedora-40",
    label: "Fedora 40",
    platform: "linux",
    description: "Fedora Cloud 40.",
    recommendedTypes: ["s-1vcpu-2gb", "s-2vcpu-4gb"],
  },
];

const TEMPLATE_TO_DO_SLUG: Record<string, string> = {
  "do-ubuntu-22-04": "ubuntu-22-04-x64",
  "do-ubuntu-24-04": "ubuntu-24-04-x64",
  "do-debian-12": "debian-12-x64",
  "do-rocky-9": "rockylinux-9-x64",
  "do-fedora-40": "fedora-40-x64",
};

export class DigitalOceanProvider implements CloudProvider {
  readonly id = "digitalocean" as const;
  private creds: DigitalOceanCredentials;

  constructor(creds: DigitalOceanCredentials) {
    this.creds = creds;
  }

  // ---------- HTTP ----------

  private async request<T>(
    method: "GET" | "POST" | "DELETE" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.creds.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { message?: string; id?: string };
        detail = j.message ?? JSON.stringify(j);
      } catch {
        detail = await res.text();
      }
      throw new Error(`DigitalOcean ${method} ${path} → ${res.status}: ${detail}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async paginate<T, K extends string>(
    path: string,
    key: K,
  ): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}per_page=200`;
    while (next) {
      const page = (await this.request<Record<string, unknown>>("GET", next)) as Record<string, unknown>;
      const items = page[key];
      if (Array.isArray(items)) out.push(...(items as T[]));
      const links = page["links"] as { pages?: { next?: string } } | undefined;
      next = links?.pages?.next;
    }
    return out;
  }

  // ---------- mapping ----------

  private mapState(s: DoDroplet["status"]): NormalizedState {
    switch (s) {
      case "new":
        return "pending";
      case "active":
        return "running";
      case "off":
        return "stopped";
      case "archive":
        return "terminated";
      default:
        return "unknown";
    }
  }

  private mapPlatform(distribution: string): Platform {
    const d = distribution.toLowerCase();
    if (d.includes("windows")) return "windows";
    if (d.includes("mac")) return "macos";
    return "linux";
  }

  private normalize(d: DoDroplet): NormalizedInstance {
    const v4 = d.networks?.v4 ?? [];
    const pub = v4.find((n) => n.type === "public") ?? null;
    const prv = v4.find((n) => n.type === "private") ?? null;
    return {
      providerInstanceId: String(d.id),
      region: d.region.slug,
      name: d.name,
      state: this.mapState(d.status),
      platform: this.mapPlatform(d.image.distribution),
      instanceType: d.size_slug,
      publicIp: pub?.ip_address ?? null,
      publicDns: null,
      privateIp: prv?.ip_address ?? null,
      keyName: null,
      raw: d,
    };
  }

  // ---------- interface ----------

  async verify(): Promise<ProviderAccountInfo> {
    const a = await this.request<DoAccount>("GET", "/account");
    return {
      accountId: a.account.uuid,
      label: a.account.team?.name ? `${a.account.email} (${a.account.team.name})` : a.account.email,
    };
  }

  async listRegions(): Promise<string[]> {
    const data = await this.request<{ regions: { slug: string; available: boolean }[] }>(
      "GET",
      "/regions?per_page=200",
    );
    return data.regions.filter((r) => r.available).map((r) => r.slug);
  }

  async listInstances(region: string): Promise<NormalizedInstance[]> {
    const droplets = await this.paginate<DoDroplet, "droplets">("/droplets", "droplets");
    return droplets.filter((d) => d.region.slug === region).map((d) => this.normalize(d));
  }

  async getInstance(_region: string, providerInstanceId: string): Promise<NormalizedInstance | null> {
    try {
      const data = await this.request<{ droplet: DoDroplet }>("GET", `/droplets/${providerInstanceId}`);
      return this.normalize(data.droplet);
    } catch (err) {
      if (err instanceof Error && err.message.includes(" → 404")) return null;
      throw err;
    }
  }

  private async dropletAction(id: string, type: string, extra?: Record<string, unknown>): Promise<void> {
    await this.request<{ action: DoAction }>("POST", `/droplets/${id}/actions`, { type, ...extra });
  }

  async startInstance(_region: string, id: string): Promise<void> {
    await this.dropletAction(id, "power_on");
  }

  async stopInstance(_region: string, id: string): Promise<void> {
    await this.dropletAction(id, "shutdown");
  }

  async rebootInstance(_region: string, id: string): Promise<void> {
    await this.dropletAction(id, "reboot");
  }

  async terminateInstance(_region: string, id: string): Promise<void> {
    await this.request("DELETE", `/droplets/${id}`);
  }

  async createInstance(input: CreateInstanceInput): Promise<NormalizedInstance> {
    let imageRef: string | number = TEMPLATE_TO_DO_SLUG[input.template] ?? input.template;
    if (input.fromSnapshotId) {
      imageRef = Number.isFinite(Number(input.fromSnapshotId))
        ? Number(input.fromSnapshotId)
        : input.fromSnapshotId;
    }
    const sshKeys: (string | number)[] = [];
    if (input.keyName) {
      const fingerprintOrId = /^\d+$/.test(input.keyName) ? Number(input.keyName) : input.keyName;
      sshKeys.push(fingerprintOrId);
    }
    if (input.sshPublicKey) {
      const created = await this.request<{ ssh_key: DoSshKey }>("POST", "/account/keys", {
        name: `vmui-${input.name}-${Date.now()}`,
        public_key: input.sshPublicKey,
      });
      sshKeys.push(created.ssh_key.id);
    }
    const data = await this.request<{ droplet: DoDroplet }>("POST", "/droplets", {
      name: input.name,
      region: input.region,
      size: input.instanceType,
      image: imageRef,
      ssh_keys: sshKeys.length ? sshKeys : undefined,
      user_data: input.userData,
      backups: false,
      ipv6: true,
      monitoring: true,
      tags: ["vmui"],
    });
    return this.normalize(data.droplet);
  }

  async getConnectionInfo(_region: string, providerInstanceId: string): Promise<ConnectionInfo> {
    const data = await this.request<{ droplet: DoDroplet }>("GET", `/droplets/${providerInstanceId}`);
    const d = data.droplet;
    const v4 = d.networks?.v4 ?? [];
    const pub = v4.find((n) => n.type === "public");
    const ip = pub?.ip_address ?? "<no-public-ip>";
    const username = "root";
    return {
      protocol: "ssh",
      host: ip,
      port: 22,
      username,
      sshCommand: `ssh ${username}@${ip}`,
      notes: [
        `SSH as \`${username}\` using the key uploaded at create time.`,
        "DigitalOcean does not provide a built-in console password — use SSH or the cloud console (web).",
      ],
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> {
    return TEMPLATES;
  }

  async listResources(region: string, kind: ResourceKind): Promise<NormalizedResource[]> {
    switch (kind) {
      case "volume": {
        const data = await this.request<{ volumes: DoVolume[] }>(
          "GET",
          `/volumes?region=${encodeURIComponent(region)}&per_page=200`,
        );
        return data.volumes.map((v) => ({
          externalId: v.id,
          region: v.region.slug,
          kind: "volume",
          name: v.name,
          status: v.status ?? (v.droplet_ids.length ? "in-use" : "available"),
          sizeBytes: v.size_gigabytes * 1024 * 1024 * 1024,
          attachedTo: v.droplet_ids[0] ? String(v.droplet_ids[0]) : null,
          tags: Object.fromEntries((v.tags ?? []).map((t) => [t, ""])),
          raw: v,
        }));
      }
      case "snapshot": {
        const data = await this.request<{ snapshots: DoSnapshot[] }>(
          "GET",
          `/snapshots?per_page=200`,
        );
        return data.snapshots
          .filter((s) => s.regions.includes(region))
          .map((s) => ({
            externalId: s.id,
            region,
            kind: "snapshot",
            name: s.name,
            status: "available",
            sizeBytes: s.size_gigabytes * 1024 * 1024 * 1024,
            attachedTo: s.resource_type === "droplet" ? s.resource_id : null,
            tags: Object.fromEntries((s.tags ?? []).map((t) => [t, ""])),
            raw: s,
          }));
      }
      case "security-group": {
        const data = await this.request<{ firewalls: DoFirewall[] }>("GET", `/firewalls?per_page=200`);
        return data.firewalls.map((f) => ({
          externalId: f.id,
          region,
          kind: "security-group",
          name: f.name,
          status: f.status,
          attachedTo: f.droplet_ids[0] ? String(f.droplet_ids[0]) : null,
          tags: Object.fromEntries((f.tags ?? []).map((t) => [t, ""])),
          raw: f,
        }));
      }
      case "elastic-ip": {
        const data = await this.request<{ floating_ips: DoFloatingIp[] }>(
          "GET",
          `/floating_ips?per_page=200`,
        );
        return data.floating_ips
          .filter((fip) => fip.region.slug === region)
          .map((fip) => ({
            externalId: fip.ip,
            region: fip.region.slug,
            kind: "elastic-ip",
            name: fip.ip,
            status: fip.droplet ? "in-use" : "available",
            attachedTo: fip.droplet ? String(fip.droplet.id) : null,
            raw: fip,
          }));
      }
      case "vpc": {
        const data = await this.request<{ vpcs: DoVpc[] }>("GET", `/vpcs?per_page=200`);
        return data.vpcs
          .filter((v) => v.region === region)
          .map((v) => ({
            externalId: v.id,
            region,
            kind: "vpc",
            name: v.name,
            status: "available",
            raw: v,
          }));
      }
      case "load-balancer": {
        const data = await this.request<{ load_balancers: DoLoadBalancer[] }>(
          "GET",
          `/load_balancers?per_page=200`,
        );
        return data.load_balancers
          .filter((lb) => lb.region?.slug === region)
          .map((lb) => ({
            externalId: lb.id,
            region,
            kind: "load-balancer",
            name: lb.name,
            status: lb.status,
            raw: lb,
          }));
      }
      case "database": {
        const data = await this.request<{ databases: DoDatabase[] }>(
          "GET",
          `/databases?per_page=200`,
        );
        return data.databases
          .filter((d) => d.region === region)
          .map((d) => ({
            externalId: d.id,
            region,
            kind: "database",
            name: `${d.name} (${d.engine} ${d.version})`,
            status: d.status,
            tags: Object.fromEntries((d.tags ?? []).map((t) => [t, ""])),
            raw: d,
          }));
      }
      case "keypair": {
        const data = await this.request<{ ssh_keys: DoSshKey[] }>("GET", `/account/keys?per_page=200`);
        return data.ssh_keys.map((k) => ({
          externalId: String(k.id),
          region,
          kind: "keypair",
          name: k.name,
          status: "available",
          raw: { id: k.id, fingerprint: k.fingerprint, name: k.name },
        }));
      }
      case "bucket": {
        try {
          const data = await this.request<{ keys: DoSpacesKey[] }>(
            "GET",
            `/spaces/keys?per_page=200`,
          );
          return data.keys.map((k) => ({
            externalId: k.name,
            region: k.region ?? region,
            kind: "bucket",
            name: k.name,
            status: "available",
            raw: k,
          }));
        } catch {
          return [];
        }
      }
      default:
        return [];
    }
  }

  async createSnapshot(
    _region: string,
    providerInstanceId: string,
    label: string,
  ): Promise<{ snapshotId: string; note?: string }> {
    const action = await this.request<{ action: DoAction }>(
      "POST",
      `/droplets/${providerInstanceId}/actions`,
      { type: "snapshot", name: label },
    );
    return {
      snapshotId: String(action.action.id),
      note: "DigitalOcean takes droplet snapshots asynchronously; the new snapshot will appear under /snapshots after a few minutes.",
    };
  }

  async deleteSnapshot(_region: string, snapshotId: string): Promise<void> {
    await this.request("DELETE", `/snapshots/${snapshotId}`);
  }

  async applyTags(
    _region: string,
    providerInstanceId: string,
    tags: Record<string, string>,
  ): Promise<void> {
    for (const [k, v] of Object.entries(tags)) {
      const tag = v ? `${k}:${v}` : k;
      try {
        await this.request("POST", "/tags", { name: tag });
      } catch {
        // tag already exists
      }
      await this.request("POST", `/tags/${encodeURIComponent(tag)}/resources`, {
        resources: [{ resource_id: String(providerInstanceId), resource_type: "droplet" }],
      });
    }
  }

  /** List managed Kubernetes clusters — exposed for the future containers wave. */
  async listKubernetesClusters(): Promise<DoKubernetesCluster[]> {
    const data = await this.request<{ kubernetes_clusters: DoKubernetesCluster[] }>(
      "GET",
      `/kubernetes/clusters?per_page=200`,
    );
    return data.kubernetes_clusters;
  }
}
