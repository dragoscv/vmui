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
 * Proxmox VE provider — REST over PVE API.
 * Auth: API Token (user@realm!tokenid=UUID).
 * Docs: https://pve.proxmox.com/pve-docs/api-viewer/
 *
 * Self-hosted. `host` is the PVE base URL (https://pve.example.com:8006).
 * "Region" is the PVE node name.
 */

export interface ProxmoxCredentials {
  /** Base URL incl. scheme + port, no trailing slash. */
  host: string;
  /** Format: user@realm!tokenid (no value) */
  tokenId: string;
  /** UUID token secret. */
  tokenSecret: string;
  defaultRegion: string;
  /** Disable TLS verify for self-signed certs (lab only). */
  insecureTLS?: boolean;
}

interface PveVm {
  vmid: number;
  name: string;
  status: "running" | "stopped" | "paused";
  node: string;
  cpus: number;
  maxmem: number;
  maxdisk: number;
  tags?: string;
}

const TEMPLATES: InstanceTemplate[] = [
  { id: "pve-clone-100", label: "Clone of VMID 100 (recommended template)", platform: "linux", description: "Clone a pre-built template VM in your PVE cluster. Set template VMID in providerHints.templateVmId.", recommendedTypes: ["1c1g", "2c2g", "2c4g", "4c8g"] },
];

function mapState(s: PveVm["status"]): NormalizedState {
  if (s === "running") return "running";
  if (s === "stopped") return "stopped";
  if (s === "paused") return "stopping";
  return "unknown";
}

export class ProxmoxProvider implements CloudProvider {
  readonly id = "proxmox" as const;
  private creds: ProxmoxCredentials;

  constructor(creds: ProxmoxCredentials) { this.creds = creds; }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.creds.host.replace(/\/$/, "")}/api2/json${path}`;
    const headers: Record<string, string> = {
      "authorization": `PVEAPIToken=${this.creds.tokenId}=${this.creds.tokenSecret}`,
      "content-type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Proxmox ${res.status}: ${body.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    return await res.json() as T;
  }

  private normalize(v: PveVm): NormalizedInstance {
    return {
      providerInstanceId: `${v.node}/${v.vmid}`,
      name: v.name,
      region: v.node,
      state: mapState(v.status),
      instanceType: `${v.cpus}c${Math.round(v.maxmem / 1024 / 1024 / 1024)}g`,
      platform: "linux" as const,
      publicIp: null,
      publicDns: null,
      privateIp: null,
      keyName: null,
      raw: v as unknown as Record<string, unknown>,
    };
  }

  async verify(): Promise<ProviderAccountInfo> {
    const r = await this.req<{ data: { release: string; version: string }[] | { release: string; version: string } }>("/version");
    const v = Array.isArray(r.data) ? r.data[0] : r.data;
    return { accountId: this.creds.host, label: `Proxmox VE ${v?.version ?? "?"} (${v?.release ?? "?"})` };
  }

  async listRegions(): Promise<string[]> {
    const r = await this.req<{ data: { node: string; status: string }[] }>("/nodes");
    return r.data.map((n) => n.node);
  }

  async listInstances(_region: string): Promise<NormalizedInstance[]> {
    const r = await this.req<{ data: PveVm[] }>("/cluster/resources?type=vm");
    return r.data.map((v) => this.normalize(v));
  }

  async getInstance(_region: string, id: string): Promise<NormalizedInstance | null> {
    const [node, vmid] = id.split("/", 2);
    if (!node || !vmid) return null;
    try {
      const r = await this.req<{ data: PveVm }>(`/nodes/${node}/qemu/${vmid}/status/current`);
      return this.normalize({ ...r.data, vmid: Number(vmid), node });
    } catch { return null; }
  }

  async startInstance(_region: string, id: string): Promise<void> {
    const [node, vmid] = id.split("/", 2);
    await this.req(`/nodes/${node}/qemu/${vmid}/status/start`, { method: "POST", body: "{}" });
  }
  async stopInstance(_region: string, id: string): Promise<void> {
    const [node, vmid] = id.split("/", 2);
    await this.req(`/nodes/${node}/qemu/${vmid}/status/shutdown`, { method: "POST", body: "{}" });
  }
  async rebootInstance(_region: string, id: string): Promise<void> {
    const [node, vmid] = id.split("/", 2);
    await this.req(`/nodes/${node}/qemu/${vmid}/status/reboot`, { method: "POST", body: "{}" });
  }
  async terminateInstance(_region: string, id: string): Promise<void> {
    const [node, vmid] = id.split("/", 2);
    await this.req(`/nodes/${node}/qemu/${vmid}?purge=1&destroy-unreferenced-disks=1`, { method: "DELETE" });
  }

  async createInstance(input: CreateInstanceInput): Promise<NormalizedInstance> {
    const node = input.region;
    const templateVmId = input.providerHints?.templateVmId ?? "100";
    // pick next free VMID via cluster API
    const nextId = await this.req<{ data: string }>("/cluster/nextid");
    const newId = Number(nextId.data);
    await this.req(`/nodes/${node}/qemu/${templateVmId}/clone`, {
      method: "POST",
      body: JSON.stringify({ newid: newId, name: input.name, full: 1 }),
    });
    // best effort wait for clone, then return current state
    await new Promise((r) => setTimeout(r, 1500));
    const inst = await this.getInstance(node, `${node}/${newId}`);
    if (!inst) throw new Error(`Clone to VMID ${newId} did not appear in time`);
    return inst;
  }

  async getConnectionInfo(_region: string, id: string): Promise<ConnectionInfo> {
    const [node, vmid] = id.split("/", 2);
    return {
      protocol: "vnc",
      host: this.creds.host.replace(/^https?:\/\//, "").replace(/:\d+$/, ""),
      port: 5900,
      username: "root",
      vncUrl: `${this.creds.host}/#v1:0:=qemu%2F${vmid}:::::::`,
      notes: [
        `Open Proxmox web console for node ${node}, VM ${vmid}.`,
        `Or use noVNC over the PVE API.`,
      ],
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> { return TEMPLATES; }

  async applyTags(_region: string, id: string, tags: Record<string, string>): Promise<void> {
    const [node, vmid] = id.split("/", 2);
    const tagStr = Object.entries(tags).map(([k, v]) => v ? `${k}=${v}` : k).join(";");
    await this.req(`/nodes/${node}/qemu/${vmid}/config`, { method: "PUT", body: JSON.stringify({ tags: tagStr }) });
  }

  async createSnapshot(_region: string, id: string, label: string): Promise<{ snapshotId: string }> {
    const [node, vmid] = id.split("/", 2);
    const snapname = label.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32);
    await this.req(`/nodes/${node}/qemu/${vmid}/snapshot`, {
      method: "POST",
      body: JSON.stringify({ snapname }),
    });
    return { snapshotId: snapname };
  }
}
