import "server-only";
import { createHash } from "node:crypto";
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
 * OVHcloud Public Cloud — signed REST API.
 *
 * Auth: each request is signed as
 *   sha1(applicationSecret + "+" + consumerKey + "+" + METHOD + "+" + URL + "+" + BODY + "+" + TIMESTAMP)
 *
 * Docs: https://help.ovhcloud.com/csm/en-api-getting-started-ovhcloud-api
 */

export interface OvhCredentials {
  endpoint: "ovh-eu" | "ovh-ca" | "ovh-us";
  applicationKey: string;
  applicationSecret: string;
  consumerKey: string;
  /** OVH project id (a.k.a. serviceName for /cloud/project/{id}) */
  projectId: string;
  defaultRegion: string;
}

const ENDPOINT_BASE: Record<OvhCredentials["endpoint"], string> = {
  "ovh-eu": "https://eu.api.ovh.com/1.0",
  "ovh-ca": "https://ca.api.ovh.com/1.0",
  "ovh-us": "https://api.us.ovhcloud.com/1.0",
};

interface OvhInstance {
  id: string;
  name: string;
  status: string;
  region: string;
  ipAddresses?: { ip: string; type: "private" | "public"; version: 4 | 6 }[];
  flavorId: string;
  imageId: string;
  sshKeyId?: string;
}

const TEMPLATES: InstanceTemplate[] = [
  { id: "ubuntu-24-04", label: "Ubuntu 24.04 LTS", platform: "linux", description: "OVH Ubuntu 24.04 image", recommendedTypes: ["s1-2", "s1-4", "b2-7"] },
  { id: "debian-12", label: "Debian 12", platform: "linux", description: "OVH Debian 12 image", recommendedTypes: ["s1-2", "s1-4"] },
];

function mapState(s: string): NormalizedState {
  const v = s.toLowerCase();
  if (v === "active") return "running";
  if (v === "stopped" || v === "shutoff") return "stopped";
  if (v === "build" || v === "building" || v === "rebuild") return "pending";
  if (v === "deleted") return "shutting-down";
  return "unknown";
}

export class OvhProvider implements CloudProvider {
  readonly id = "ovh" as const;
  private creds: OvhCredentials;

  constructor(creds: OvhCredentials) { this.creds = creds; }

  private async timeDelta(): Promise<number> {
    const res = await fetch(`${ENDPOINT_BASE[this.creds.endpoint]}/auth/time`, { signal: AbortSignal.timeout(10_000) });
    const ovhTime = Number(await res.text());
    return ovhTime - Math.floor(Date.now() / 1000);
  }

  private async req<T>(path: string, init?: RequestInit & { body?: string }): Promise<T> {
    const base = ENDPOINT_BASE[this.creds.endpoint];
    const url = `${base}${path}`;
    const method = init?.method ?? "GET";
    const body = init?.body ?? "";
    const delta = await this.timeDelta();
    const ts = String(Math.floor(Date.now() / 1000) + delta);
    const sig = "$1$" + createHash("sha1")
      .update(`${this.creds.applicationSecret}+${this.creds.consumerKey}+${method}+${url}+${body}+${ts}`)
      .digest("hex");
    const headers: Record<string, string> = {
      "X-Ovh-Application": this.creds.applicationKey,
      "X-Ovh-Consumer": this.creds.consumerKey,
      "X-Ovh-Timestamp": ts,
      "X-Ovh-Signature": sig,
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    const res = await fetch(url, { method, body: body || undefined, headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OVH ${res.status}: ${txt.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    return await res.json() as T;
  }

  private normalize(v: OvhInstance): NormalizedInstance {
    const pubIp = v.ipAddresses?.find((a) => a.type === "public" && a.version === 4)?.ip ?? null;
    const privIp = v.ipAddresses?.find((a) => a.type === "private" && a.version === 4)?.ip ?? null;
    return {
      providerInstanceId: v.id,
      name: v.name,
      region: v.region,
      state: mapState(v.status),
      instanceType: v.flavorId,
      platform: "linux" as const,
      publicIp: pubIp,
      publicDns: null,
      privateIp: privIp,
      keyName: v.sshKeyId ?? null,
      raw: v as unknown as Record<string, unknown>,
    };
  }

  async verify(): Promise<ProviderAccountInfo> {
    await this.req<unknown>(`/cloud/project/${this.creds.projectId}`);
    return { accountId: this.creds.projectId, label: `OVH project ${this.creds.projectId.slice(0, 8)}` };
  }

  async listRegions(): Promise<string[]> {
    return await this.req<string[]>(`/cloud/project/${this.creds.projectId}/region`);
  }

  async listInstances(region: string): Promise<NormalizedInstance[]> {
    const all = await this.req<OvhInstance[]>(`/cloud/project/${this.creds.projectId}/instance?region=${encodeURIComponent(region)}`);
    return all.map((v) => this.normalize(v));
  }

  async getInstance(_region: string, id: string): Promise<NormalizedInstance | null> {
    try {
      const v = await this.req<OvhInstance>(`/cloud/project/${this.creds.projectId}/instance/${id}`);
      return this.normalize(v);
    } catch { return null; }
  }

  async startInstance(_region: string, id: string): Promise<void> {
    await this.req(`/cloud/project/${this.creds.projectId}/instance/${id}/start`, { method: "POST", body: "{}" });
  }
  async stopInstance(_region: string, id: string): Promise<void> {
    await this.req(`/cloud/project/${this.creds.projectId}/instance/${id}/stop`, { method: "POST", body: "{}" });
  }
  async rebootInstance(_region: string, id: string): Promise<void> {
    await this.req(`/cloud/project/${this.creds.projectId}/instance/${id}/reboot`, { method: "POST", body: JSON.stringify({ type: "soft" }) });
  }
  async terminateInstance(_region: string, id: string): Promise<void> {
    await this.req(`/cloud/project/${this.creds.projectId}/instance/${id}`, { method: "DELETE" });
  }

  async createInstance(input: CreateInstanceInput): Promise<NormalizedInstance> {
    const flavorId = input.providerHints?.flavorId ?? input.instanceType;
    const imageId = input.providerHints?.imageId;
    if (!imageId) throw new Error("OVH createInstance requires providerHints.imageId");
    const body = JSON.stringify({
      flavorId,
      imageId,
      name: input.name,
      region: input.region,
      sshKeyId: input.providerHints?.sshKeyId,
      monthlyBilling: false,
    });
    const v = await this.req<OvhInstance>(`/cloud/project/${this.creds.projectId}/instance`, { method: "POST", body });
    return this.normalize(v);
  }

  async getConnectionInfo(_region: string, id: string): Promise<ConnectionInfo> {
    const inst = await this.getInstance(_region, id);
    if (!inst?.publicIp) throw new Error("No public IP on instance");
    return {
      protocol: "ssh",
      host: inst.publicIp,
      port: 22,
      username: "ubuntu",
      sshCommand: `ssh ubuntu@${inst.publicIp}`,
      notes: ["Default user is image-dependent (ubuntu / debian / centos)."],
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> { return TEMPLATES; }
}
