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
 * Hetzner Cloud provider.
 *
 * API: https://docs.hetzner.cloud/
 * Auth: Bearer API token created per project (scope: read/write).
 *
 * VM resource is the "server". Datacenters and locations:
 *  - locations: nbg1 (Nuremberg), fsn1 (Falkenstein), hel1 (Helsinki),
 *    ash (Ashburn US-East), hil (Hillsboro US-West), sin (Singapore).
 * Server types: cax11/cax21/cax31/cax41 (ARM), cpx11/cpx21/cpx31 (AMD),
 * cx22/cx32 (Intel shared), ccx13/ccx23/ccx33 (dedicated).
 */

export interface HetznerCredentials {
  /** Hetzner Cloud API token (scope: read or read+write). */
  token: string;
  /** Default location id (nbg1, fsn1, hel1, ash, hil, sin). */
  defaultRegion: string;
}

const API_BASE = "https://api.hetzner.cloud/v1";

interface HzServer {
  id: number;
  name: string;
  status:
    | "running"
    | "initializing"
    | "starting"
    | "stopping"
    | "off"
    | "deleting"
    | "rebuilding"
    | "migrating"
    | "unknown";
  created: string;
  public_net: {
    ipv4: { id: number; ip: string; blocked: boolean } | null;
    ipv6: { id: number; ip: string; blocked: boolean } | null;
  };
  private_net: { ip: string; network: number }[];
  server_type: { id: number; name: string; cores: number; memory: number; disk: number };
  datacenter: { id: number; name: string; location: { name: string; city: string; country: string } };
  image: { id: number; name: string | null; description: string; os_flavor: string; os_version: string | null } | null;
  labels: Record<string, string>;
}

interface HzAction {
  id: number;
  command: string;
  status: "running" | "success" | "error";
  error?: { code: string; message: string } | null;
}

interface HzVolume {
  id: number;
  name: string;
  size: number; // GB
  location: { name: string };
  server: number | null;
  status: string;
  labels: Record<string, string>;
}

interface HzImage {
  id: number;
  type: string;
  status: string;
  name: string | null;
  description: string;
  image_size?: number;
  disk_size?: number;
  labels: Record<string, string>;
  created_from?: { id: number; name: string } | null;
}

interface HzFirewall {
  id: number;
  name: string;
  applied_to: { type: string; server?: { id: number } }[];
  labels: Record<string, string>;
}

interface HzFloatingIp {
  id: number;
  ip: string;
  type: string;
  server: number | null;
  home_location: { name: string };
  labels: Record<string, string>;
}

interface HzNetwork {
  id: number;
  name: string;
  ip_range: string;
  servers: number[];
  labels: Record<string, string>;
}

interface HzLoadBalancer {
  id: number;
  name: string;
  load_balancer_type: { name: string };
  location: { name: string };
  public_net: { ipv4: { ip: string } | null };
  labels: Record<string, string>;
}

interface HzSshKey {
  id: number;
  name: string;
  fingerprint: string;
  public_key: string;
  labels: Record<string, string>;
}

const TEMPLATES: InstanceTemplate[] = [
  {
    id: "hetzner-ubuntu-24-04",
    label: "Ubuntu 24.04",
    platform: "linux",
    description: "Canonical Ubuntu 24.04 LTS — Hetzner official image.",
    recommendedTypes: ["cax11", "cx22", "cpx11", "cpx21", "cax21", "cax31"],
    notes: ["ARM64 (cax*) is significantly cheaper than x86 (cx*/cpx*) for the same RAM/CPU."],
  },
  {
    id: "hetzner-ubuntu-22-04",
    label: "Ubuntu 22.04",
    platform: "linux",
    description: "Canonical Ubuntu 22.04 LTS.",
    recommendedTypes: ["cax11", "cx22", "cpx11", "cpx21"],
  },
  {
    id: "hetzner-debian-12",
    label: "Debian 12",
    platform: "linux",
    description: "Debian 12 (Bookworm).",
    recommendedTypes: ["cax11", "cx22", "cpx11"],
  },
  {
    id: "hetzner-fedora-40",
    label: "Fedora 40",
    platform: "linux",
    description: "Fedora Cloud 40.",
    recommendedTypes: ["cax11", "cx22", "cpx11"],
  },
  {
    id: "hetzner-rocky-9",
    label: "Rocky Linux 9",
    platform: "linux",
    description: "Rocky Linux 9 (RHEL-compatible).",
    recommendedTypes: ["cax11", "cx22", "cpx11"],
  },
];

const TEMPLATE_TO_HZ_IMAGE: Record<string, string> = {
  "hetzner-ubuntu-24-04": "ubuntu-24.04",
  "hetzner-ubuntu-22-04": "ubuntu-22.04",
  "hetzner-debian-12": "debian-12",
  "hetzner-fedora-40": "fedora-40",
  "hetzner-rocky-9": "rocky-9",
};

export class HetznerProvider implements CloudProvider {
  readonly id = "hetzner" as const;
  private creds: HetznerCredentials;

  constructor(creds: HetznerCredentials) {
    this.creds = creds;
  }

  // ---------- HTTP ----------

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
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
        const j = (await res.json()) as { error?: { code?: string; message?: string } };
        detail = j.error?.message ?? JSON.stringify(j);
      } catch {
        detail = await res.text();
      }
      throw new Error(`Hetzner ${method} ${path} → ${res.status}: ${detail}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async listAll<T>(path: string, key: string): Promise<T[]> {
    const out: T[] = [];
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const sep = path.includes("?") ? "&" : "?";
      const data = (await this.request<Record<string, unknown>>(
        "GET",
        `${path}${sep}page=${page}&per_page=50`,
      )) as Record<string, unknown>;
      const items = data[key];
      if (Array.isArray(items)) out.push(...(items as T[]));
      const meta = data["meta"] as { pagination?: { next_page: number | null } } | undefined;
      const next = meta?.pagination?.next_page;
      if (!next) break;
      page = next;
    }
    return out;
  }

  // ---------- mapping ----------

  private mapState(s: HzServer["status"]): NormalizedState {
    switch (s) {
      case "initializing":
      case "starting":
      case "rebuilding":
      case "migrating":
        return "pending";
      case "running":
        return "running";
      case "stopping":
        return "stopping";
      case "off":
        return "stopped";
      case "deleting":
        return "shutting-down";
      default:
        return "unknown";
    }
  }

  private mapPlatform(s: HzServer): Platform {
    const flavor = s.image?.os_flavor?.toLowerCase() ?? "";
    if (flavor.includes("windows")) return "windows";
    return "linux";
  }

  private normalize(s: HzServer): NormalizedInstance {
    return {
      providerInstanceId: String(s.id),
      region: s.datacenter.location.name,
      name: s.name,
      state: this.mapState(s.status),
      platform: this.mapPlatform(s),
      instanceType: s.server_type.name,
      publicIp: s.public_net?.ipv4?.ip ?? null,
      publicDns: null,
      privateIp: s.private_net[0]?.ip ?? null,
      keyName: null,
      raw: s,
    };
  }

  // ---------- interface ----------

  async verify(): Promise<ProviderAccountInfo> {
    // /servers is the cheapest authenticated request; no /account endpoint exists.
    await this.request<{ servers: HzServer[] }>("GET", "/servers?per_page=1");
    const tokenSuffix = this.creds.token.slice(-6);
    return {
      accountId: `hetzner-${tokenSuffix}`,
      label: `Hetzner project (token …${tokenSuffix})`,
    };
  }

  async listRegions(): Promise<string[]> {
    const data = await this.request<{ locations: { name: string }[] }>("GET", "/locations");
    return data.locations.map((l) => l.name);
  }

  async listInstances(region: string): Promise<NormalizedInstance[]> {
    const servers = await this.listAll<HzServer>("/servers", "servers");
    return servers
      .filter((s) => s.datacenter.location.name === region)
      .map((s) => this.normalize(s));
  }

  async getInstance(_region: string, providerInstanceId: string): Promise<NormalizedInstance | null> {
    try {
      const data = await this.request<{ server: HzServer }>("GET", `/servers/${providerInstanceId}`);
      return this.normalize(data.server);
    } catch (err) {
      if (err instanceof Error && err.message.includes(" → 404")) return null;
      throw err;
    }
  }

  private async serverAction(id: string, action: string, body?: unknown): Promise<void> {
    await this.request<{ action: HzAction }>("POST", `/servers/${id}/actions/${action}`, body ?? {});
  }

  async startInstance(_region: string, id: string): Promise<void> {
    await this.serverAction(id, "poweron");
  }

  async stopInstance(_region: string, id: string): Promise<void> {
    await this.serverAction(id, "shutdown");
  }

  async rebootInstance(_region: string, id: string): Promise<void> {
    await this.serverAction(id, "reboot");
  }

  async terminateInstance(_region: string, id: string): Promise<void> {
    await this.request("DELETE", `/servers/${id}`);
  }

  async createInstance(input: CreateInstanceInput): Promise<NormalizedInstance> {
    let imageRef: string | number = TEMPLATE_TO_HZ_IMAGE[input.template] ?? input.template;
    if (input.fromSnapshotId) {
      imageRef = Number.isFinite(Number(input.fromSnapshotId))
        ? Number(input.fromSnapshotId)
        : input.fromSnapshotId;
    }
    const sshKeys: (string | number)[] = [];
    if (input.keyName) {
      sshKeys.push(/^\d+$/.test(input.keyName) ? Number(input.keyName) : input.keyName);
    }
    if (input.sshPublicKey) {
      const created = await this.request<{ ssh_key: HzSshKey }>("POST", "/ssh_keys", {
        name: `vmui-${input.name}-${Date.now()}`,
        public_key: input.sshPublicKey,
      });
      sshKeys.push(created.ssh_key.id);
    }
    const data = await this.request<{ server: HzServer }>("POST", "/servers", {
      name: input.name,
      server_type: input.instanceType,
      location: input.region,
      image: imageRef,
      ssh_keys: sshKeys.length ? sshKeys : undefined,
      user_data: input.userData,
      start_after_create: true,
      labels: { "managed-by": "vmui" },
    });
    return this.normalize(data.server);
  }

  async getConnectionInfo(_region: string, providerInstanceId: string): Promise<ConnectionInfo> {
    const data = await this.request<{ server: HzServer }>("GET", `/servers/${providerInstanceId}`);
    const s = data.server;
    const ip = s.public_net?.ipv4?.ip ?? "<no-public-ipv4>";
    const username = "root";
    return {
      protocol: "ssh",
      host: ip,
      port: 22,
      username,
      sshCommand: `ssh ${username}@${ip}`,
      notes: [
        `SSH as \`${username}\` using your uploaded key.`,
        "Hetzner emails an initial root password if you create without an SSH key — check your inbox.",
      ],
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> {
    return TEMPLATES;
  }

  async listResources(region: string, kind: ResourceKind): Promise<NormalizedResource[]> {
    switch (kind) {
      case "volume": {
        const volumes = await this.listAll<HzVolume>("/volumes", "volumes");
        return volumes
          .filter((v) => v.location.name === region)
          .map((v) => ({
            externalId: String(v.id),
            region: v.location.name,
            kind: "volume",
            name: v.name,
            status: v.status === "available" && v.server ? "in-use" : v.status,
            sizeBytes: v.size * 1024 * 1024 * 1024,
            attachedTo: v.server ? String(v.server) : null,
            tags: v.labels,
            raw: v,
          }));
      }
      case "snapshot": {
        const data = await this.request<{ images: HzImage[] }>(
          "GET",
          "/images?type=snapshot&per_page=50",
        );
        return data.images.map((i) => ({
          externalId: String(i.id),
          region,
          kind: "snapshot",
          name: i.description ?? i.name ?? String(i.id),
          status: i.status,
          sizeBytes: (i.image_size ?? i.disk_size ?? 0) * 1024 * 1024 * 1024,
          attachedTo: i.created_from ? String(i.created_from.id) : null,
          tags: i.labels,
          raw: i,
        }));
      }
      case "image": {
        const data = await this.request<{ images: HzImage[] }>(
          "GET",
          "/images?type=backup&per_page=50",
        );
        return data.images.map((i) => ({
          externalId: String(i.id),
          region,
          kind: "image",
          name: i.description,
          status: i.status,
          sizeBytes: (i.image_size ?? i.disk_size ?? 0) * 1024 * 1024 * 1024,
          attachedTo: i.created_from ? String(i.created_from.id) : null,
          tags: i.labels,
          raw: i,
        }));
      }
      case "security-group": {
        const fws = await this.listAll<HzFirewall>("/firewalls", "firewalls");
        return fws.map((f) => ({
          externalId: String(f.id),
          region,
          kind: "security-group",
          name: f.name,
          status: "active",
          attachedTo: f.applied_to.find((a) => a.server)?.server?.id
            ? String(f.applied_to.find((a) => a.server)!.server!.id)
            : null,
          tags: f.labels,
          raw: f,
        }));
      }
      case "elastic-ip": {
        const ips = await this.listAll<HzFloatingIp>("/floating_ips", "floating_ips");
        return ips
          .filter((i) => i.home_location.name === region)
          .map((i) => ({
            externalId: String(i.id),
            region: i.home_location.name,
            kind: "elastic-ip",
            name: i.ip,
            status: i.server ? "in-use" : "available",
            attachedTo: i.server ? String(i.server) : null,
            tags: i.labels,
            raw: i,
          }));
      }
      case "vpc": {
        const nets = await this.listAll<HzNetwork>("/networks", "networks");
        return nets.map((n) => ({
          externalId: String(n.id),
          region,
          kind: "vpc",
          name: `${n.name} (${n.ip_range})`,
          status: "available",
          tags: n.labels,
          raw: n,
        }));
      }
      case "load-balancer": {
        const lbs = await this.listAll<HzLoadBalancer>("/load_balancers", "load_balancers");
        return lbs
          .filter((lb) => lb.location.name === region)
          .map((lb) => ({
            externalId: String(lb.id),
            region: lb.location.name,
            kind: "load-balancer",
            name: lb.name,
            status: lb.public_net?.ipv4?.ip ?? "provisioning",
            tags: lb.labels,
            raw: lb,
          }));
      }
      case "keypair": {
        const keys = await this.listAll<HzSshKey>("/ssh_keys", "ssh_keys");
        return keys.map((k) => ({
          externalId: String(k.id),
          region,
          kind: "keypair",
          name: k.name,
          status: "available",
          tags: k.labels,
          raw: { id: k.id, fingerprint: k.fingerprint, name: k.name },
        }));
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
    const data = await this.request<{ image: HzImage; action: HzAction }>(
      "POST",
      `/servers/${providerInstanceId}/actions/create_image`,
      { type: "snapshot", description: label },
    );
    return {
      snapshotId: String(data.image.id),
      note: "Hetzner snapshots are billed monthly per GB. Stop the server first for a crash-consistent snapshot.",
    };
  }

  async deleteSnapshot(_region: string, snapshotId: string): Promise<void> {
    await this.request("DELETE", `/images/${snapshotId}`);
  }

  async applyTags(
    _region: string,
    providerInstanceId: string,
    tags: Record<string, string>,
  ): Promise<void> {
    await this.request("PUT", `/servers/${providerInstanceId}`, {
      labels: tags,
    });
  }
}
