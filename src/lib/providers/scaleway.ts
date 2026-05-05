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
 * Scaleway Apple Silicon (Mac mini bare-metal) provider.
 *
 * API ref: https://www.scaleway.com/en/developers/api/apple-silicon/
 * Auth:    X-Auth-Token header (Scaleway IAM API secret key, UUID-shaped).
 * Zones:   fr-par-1 (M2 / M2-Pro / M4)  and  fr-par-3 (M1).
 *
 * Notes:
 *  - Mac minis are bare metal — there is no "stop" operation. Reboot/terminate only.
 *  - 24-hour minimum lease (Apple licensing). Server has `deletable_at` timestamp.
 *  - Hourly billing afterwards (~€0.11/h M1 — far cheaper than AWS EC2 Mac).
 */

export interface ScalewayCredentials {
  /** Scaleway IAM secret key (UUID format). */
  secretKey: string;
  /** Scaleway project UUID — required for creating servers. */
  projectId: string;
  /** Default zone: fr-par-1 or fr-par-3. */
  defaultZone: string;
}

const API_BASE = "https://api.scaleway.com";
const APPLE_SILICON_PATH = "/apple-silicon/v1alpha1/zones";

const ZONES = ["fr-par-1", "fr-par-3"] as const;

const TEMPLATES: InstanceTemplate[] = [
  {
    id: "scaleway-mac-mini",
    label: "Mac mini (Apple Silicon)",
    platform: "macos",
    description:
      "Dedicated Apple Mac mini (M1 / M2 / M2-Pro / M4) with native macOS. SSH + VNC out-of-the-box.",
    recommendedTypes: ["M1-M", "M2-M", "M2-L", "M2-PRO-M", "M4-M"],
    notes: [
      "24-hour minimum lease enforced by Apple's macOS license — earliest deletion is 24h after creation.",
      "After the first 24h, billing is hourly (~€0.11/h for M1, no commitment).",
      "M1 is only available in fr-par-3. M2 / M2-Pro / M4 are in fr-par-1.",
      "Connection: SSH on port 22 (username from API), VNC on a randomly-assigned port (returned in vnc_url).",
    ],
  },
];

interface ScalewayServer {
  id: string;
  type: string;
  name: string;
  project_id: string;
  organization_id: string;
  ip: string | null;
  vnc_url: string | null;
  ssh_username: string | null;
  sudo_password?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  deletable_at: string | null;
  zone: string;
}

interface ScalewayServersList {
  servers: ScalewayServer[];
  total_count: number;
}

interface ScalewayProject {
  id: string;
  name: string;
  organization_id: string;
}

export class ScalewayProvider implements CloudProvider {
  readonly id = "scaleway" as const;
  private creds: ScalewayCredentials;

  constructor(creds: ScalewayCredentials) {
    this.creds = creds;
  }

  // ---------- HTTP helpers ----------

  private async request<T>(
    method: "GET" | "POST" | "DELETE" | "PATCH",
    url: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: {
        "X-Auth-Token": this.creds.secretKey,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { message?: string; details?: unknown };
        detail = j.message ?? JSON.stringify(j);
      } catch {
        detail = await res.text();
      }
      throw new Error(`Scaleway ${method} ${url} → ${res.status}: ${detail}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private zoneUrl(zone: string, suffix = ""): string {
    return `${API_BASE}${APPLE_SILICON_PATH}/${zone}${suffix}`;
  }

  // ---------- State / shape mapping ----------

  private mapState(scwStatus: string): NormalizedState {
    switch (scwStatus) {
      case "ready":
      case "delivered":
      case "running":
        return "running";
      case "starting":
      case "rebooting":
      case "reinstalling":
      case "updating":
      case "delivering":
        return "pending";
      case "stopping":
        return "stopping";
      case "stopped":
        return "stopped";
      case "deleting":
      case "locked":
      case "locking":
      case "unlocking":
        return "shutting-down";
      case "error":
        return "unknown";
      default:
        return "unknown";
    }
  }

  private normalize(s: ScalewayServer): NormalizedInstance {
    return {
      providerInstanceId: s.id,
      region: s.zone,
      name: s.name,
      state: this.mapState(s.status),
      platform: "macos",
      instanceType: s.type,
      publicIp: s.ip,
      publicDns: null,
      privateIp: null,
      keyName: null,
      raw: s,
    };
  }

  // ---------- Interface implementation ----------

  async verify(): Promise<ProviderAccountInfo> {
    // Confirms both that the secret key works AND that the project_id belongs to it.
    const proj = await this.request<ScalewayProject>(
      "GET",
      `${API_BASE}/account/v3/projects/${this.creds.projectId}`,
    );
    return {
      accountId: proj.organization_id,
      label: `${proj.name} (${proj.id.slice(0, 8)}…)`,
    };
  }

  async listRegions(): Promise<string[]> {
    return [...ZONES];
  }

  async listInstances(region: string): Promise<NormalizedInstance[]> {
    const params = new URLSearchParams({
      project_id: this.creds.projectId,
      page: "1",
      per_page: "100",
    });
    const data = await this.request<ScalewayServersList>(
      "GET",
      `${this.zoneUrl(region, "/servers")}?${params.toString()}`,
    );
    return data.servers.map((s) => this.normalize(s));
  }

  async getInstance(region: string, providerInstanceId: string): Promise<NormalizedInstance | null> {
    try {
      const s = await this.request<ScalewayServer>(
        "GET",
        this.zoneUrl(region, `/servers/${providerInstanceId}`),
      );
      return this.normalize(s);
    } catch (err) {
      if (err instanceof Error && err.message.includes(" → 404")) return null;
      throw err;
    }
  }

  async startInstance(_region: string, _id: string): Promise<void> {
    throw new Error(
      "Scaleway Apple Silicon Mac minis are bare-metal and always on — there is no start operation. Use reboot if needed.",
    );
  }

  async stopInstance(_region: string, _id: string): Promise<void> {
    throw new Error(
      "Scaleway Apple Silicon Mac minis are bare-metal and cannot be stopped without terminating. Use reboot or terminate.",
    );
  }

  async rebootInstance(region: string, id: string): Promise<void> {
    await this.request("POST", this.zoneUrl(region, `/servers/${id}/reboot`), {});
  }

  async terminateInstance(region: string, id: string): Promise<void> {
    await this.request("DELETE", this.zoneUrl(region, `/servers/${id}`));
  }

  async createInstance(input: CreateInstanceInput): Promise<NormalizedInstance> {
    const created = await this.request<ScalewayServer>(
      "POST",
      this.zoneUrl(input.region, "/servers"),
      {
        name: input.name,
        project_id: this.creds.projectId,
        type: input.instanceType,
      },
    );
    return this.normalize(created);
  }

  async getConnectionInfo(region: string, providerInstanceId: string): Promise<ConnectionInfo> {
    const s = await this.request<ScalewayServer>(
      "GET",
      this.zoneUrl(region, `/servers/${providerInstanceId}`),
    );
    const ip = s.ip ?? "<no-public-ip-yet>";
    const sshUser = s.ssh_username ?? "m1";
    const sshCommand = `ssh ${sshUser}@${ip}`;

    // vnc_url format: vnc://<user>:<password>@<host>:<port>
    let vncHost = ip;
    let vncPort = 5900;
    let vncUser = sshUser;
    let vncPassword: string | null = null;
    if (s.vnc_url) {
      try {
        const u = new URL(s.vnc_url);
        if (u.hostname) vncHost = u.hostname;
        if (u.port) vncPort = Number(u.port);
        if (u.username) vncUser = decodeURIComponent(u.username);
        if (u.password) vncPassword = decodeURIComponent(u.password);
      } catch {
        // ignore parse failures, fall back to ssh defaults
      }
    }

    const notes: string[] = [
      `SSH: \`${sshCommand}\` (no password — Scaleway injects your account's SSH keys at provision time).`,
      vncPassword
        ? `VNC: connect to \`${vncHost}:${vncPort}\` as user \`${vncUser}\` with the password shown in the connection bundle.`
        : `VNC: open \`${s.vnc_url ?? `vnc://${vncHost}:${vncPort}`}\` in macOS Screen Sharing or any VNC client.`,
      "On Windows, install TigerVNC Viewer (https://tigervnc.org) to use VNC.",
      `Server status: \`${s.status}\` — provisioning takes ~5 minutes for first boot.`,
    ];
    if (s.deletable_at) {
      notes.push(`Earliest deletion: ${s.deletable_at} (24h Apple-license minimum).`);
    }

    return {
      protocol: "vnc",
      host: vncHost,
      port: vncPort,
      username: vncUser,
      vncUrl: s.vnc_url ?? `vnc://${vncHost}:${vncPort}`,
      sshCommand,
      notes,
    };
  }

  async listInstanceTemplates(): Promise<InstanceTemplate[]> {
    return TEMPLATES;
  }
}
