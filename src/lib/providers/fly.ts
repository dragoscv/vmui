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
 * Fly.io Machines REST API v1.
 * Auth: `Authorization: Bearer <FLY_API_TOKEN>`
 * Docs: https://fly.io/docs/machines/api/
 *
 * "region" is a fly region code (e.g. "ord", "fra"). The provider id of an
 * instance is `${appName}/${machineId}` so we can fan out across many apps.
 */

export interface FlyCredentials {
  apiToken: string;
  /** Comma-separated list of fly app names this provider should manage. */
  appNames: string;
  defaultRegion: string;
}

interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  private_ip?: string;
  config?: { image?: string; size?: string };
}

const API = "https://api.machines.dev/v1";

const TEMPLATES: InstanceTemplate[] = [
  { id: "fly-shared-cpu-1x", label: "shared-cpu-1x · 256MB", platform: "linux", description: "Smallest fly machine", recommendedTypes: ["shared-cpu-1x"] },
  { id: "fly-shared-cpu-2x", label: "shared-cpu-2x · 512MB", platform: "linux", description: "Medium fly machine", recommendedTypes: ["shared-cpu-2x"] },
];

function mapState(s: string): NormalizedState {
  const v = s.toLowerCase();
  if (v === "started" || v === "running") return "running";
  if (v === "stopped" || v === "suspended") return "stopped";
  if (v === "starting" || v === "created") return "pending";
  if (v === "stopping") return "stopping";
  if (v === "destroyed" || v === "destroying") return "shutting-down";
  return "unknown";
}

export class FlyProvider implements CloudProvider {
  readonly id = "fly" as const;
  private creds: FlyCredentials;

  constructor(creds: FlyCredentials) { this.creds = creds; }

  private apps(): string[] {
    return this.creds.appNames.split(",").map((s) => s.trim()).filter(Boolean);
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.creds.apiToken}`,
      "content-type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    const res = await fetch(`${API}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Fly ${res.status}: ${txt.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    return await res.json() as T;
  }

  private normalize(app: string, m: FlyMachine): NormalizedInstance {
    return {
      providerInstanceId: `${app}/${m.id}`,
      name: m.name || m.id,
      region: m.region,
      state: mapState(m.state),
      instanceType: m.config?.size ?? "shared-cpu-1x",
      platform: "linux" as const,
      publicIp: null,
      publicDns: `${app}.fly.dev`,
      privateIp: m.private_ip ?? null,
      keyName: null,
      raw: m as unknown as Record<string, unknown>,
    };
  }

  async verify(): Promise<ProviderAccountInfo> {
    const apps = this.apps();
    if (apps.length === 0) throw new Error("appNames is empty");
    // Probe first app to confirm token + access.
    await this.req<unknown>(`/apps/${apps[0]}`);
    return { accountId: apps.join(","), label: `Fly · ${apps.length} app(s)` };
  }

  async listRegions(): Promise<string[]> {
    return ["ams", "arn", "atl", "bog", "bom", "bos", "cdg", "den", "dfw", "ewr", "eze", "fra", "gdl", "gig", "gru", "hkg", "iad", "jnb", "lax", "lhr", "mad", "mia", "nrt", "ord", "otp", "phx", "qro", "scl", "sea", "sin", "sjc", "syd", "waw", "yul", "yyz"];
  }

  async listInstances(region: string): Promise<NormalizedInstance[]> {
    const all: NormalizedInstance[] = [];
    for (const app of this.apps()) {
      try {
        const machines = await this.req<FlyMachine[]>(`/apps/${app}/machines`);
        for (const m of machines) {
          if (region && m.region !== region) continue;
          all.push(this.normalize(app, m));
        }
      } catch {
        /* skip apps the token can't see */
      }
    }
    return all;
  }

  async getInstance(_region: string, id: string): Promise<NormalizedInstance | null> {
    const [app, machineId] = id.split("/", 2);
    if (!app || !machineId) return null;
    try {
      const m = await this.req<FlyMachine>(`/apps/${app}/machines/${machineId}`);
      return this.normalize(app, m);
    } catch { return null; }
  }

  async startInstance(_region: string, id: string): Promise<void> {
    const [app, mid] = id.split("/", 2);
    await this.req(`/apps/${app}/machines/${mid}/start`, { method: "POST" });
  }
  async stopInstance(_region: string, id: string): Promise<void> {
    const [app, mid] = id.split("/", 2);
    await this.req(`/apps/${app}/machines/${mid}/stop`, { method: "POST", body: "{}" });
  }
  async rebootInstance(_region: string, id: string): Promise<void> {
    const [app, mid] = id.split("/", 2);
    await this.req(`/apps/${app}/machines/${mid}/restart`, { method: "POST" });
  }
  async terminateInstance(_region: string, id: string): Promise<void> {
    const [app, mid] = id.split("/", 2);
    await this.req(`/apps/${app}/machines/${mid}?force=true`, { method: "DELETE" });
  }

  async createInstance(input: CreateInstanceInput): Promise<NormalizedInstance> {
    const app = input.providerHints?.appName;
    if (!app) throw new Error("Fly createInstance requires providerHints.appName");
    const image = input.providerHints?.image ?? "registry-1.docker.io/library/nginx:latest";
    const body = JSON.stringify({
      name: input.name,
      region: input.region,
      config: {
        image,
        guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
        env: input.providerHints?.env ?? {},
      },
    });
    const m = await this.req<FlyMachine>(`/apps/${app}/machines`, { method: "POST", body });
    return this.normalize(app, m);
  }

  async getConnectionInfo(_region: string, id: string): Promise<ConnectionInfo> {
    const [app, mid] = id.split("/", 2);
    return {
      protocol: "ssh",
      host: `${app}.fly.dev`,
      port: 22,
      username: "root",
      sshCommand: `flyctl ssh console -a ${app} --machine ${mid}`,
      notes: [
        `Use \`flyctl ssh console\` for the simplest path; vmui doesn't proxy fly's WireGuard tunnel.`,
        `Or set up a fly WireGuard peer and connect via the machine's private IP (6PN).`,
      ],
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> { return TEMPLATES; }
}
