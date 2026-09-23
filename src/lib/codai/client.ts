import { DEFAULT_CODAI_GATEWAY_URL } from "./install-command";

export interface CodaiProject {
  id: string;
  name: string;
  slug: string;
}

export type CodaiEnvironmentState =
  | "pending"
  | "creating"
  | "enrolling"
  | "running"
  | "stopping"
  | "stopped"
  | "archived"
  | "destroying"
  | "destroyed"
  | "error"
  | (string & {});

export interface CodaiEnvironment {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  state: CodaiEnvironmentState;
  stateReason?: string | null;
}

export interface EnrollToken {
  token: string;
  expires_at: string;
  environment_id: string;
}

export interface CodaiClientOptions {
  gatewayUrl?: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class CodaiApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "CodaiApiError";
  }
}

/**
 * Thin client for the codai Environments API (`apps/gateway/src/routes/environments.ts`).
 * The api key only ever travels in the `Authorization` header; error messages
 * never echo request bodies or headers.
 */
export class CodaiClient {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: CodaiClientOptions) {
    this.base = (opts.gatewayUrl ?? DEFAULT_CODAI_GATEWAY_URL).replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const msg =
          json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "object"
            ? String(((json as { error: { message?: unknown } }).error.message as string | undefined) ?? res.statusText)
            : json && typeof json === "object" && "message" in json
              ? String((json as { message: unknown }).message)
              : res.statusText || `HTTP ${res.status}`;
        throw new CodaiApiError(res.status, path, `codai ${method} ${path} → ${res.status}: ${msg}`);
      }
      return json as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async listProjects(): Promise<CodaiProject[]> {
    const r = await this.call<{ projects: CodaiProject[] }>("GET", "/v1/projects");
    return r.projects ?? [];
  }

  async createProject(name: string): Promise<CodaiProject> {
    const r = await this.call<{ project: CodaiProject }>("POST", "/v1/projects", { name });
    return r.project;
  }

  /** Reuse a project by id, else by exact name, else create it. */
  async ensureProject(input: { projectId?: string; projectName?: string }): Promise<CodaiProject> {
    const projects = await this.listProjects();
    if (input.projectId) {
      const hit = projects.find((p) => p.id === input.projectId);
      if (!hit) throw new Error("codai project not found or not accessible");
      return hit;
    }
    const name = input.projectName?.trim();
    if (!name) throw new Error("A project id or a project name is required");
    const byName = projects.find((p) => p.name === name || p.slug === name);
    if (byName) return byName;
    return this.createProject(name);
  }

  async createByoEnvironment(projectId: string, name: string): Promise<CodaiEnvironment> {
    const r = await this.call<{ environment: CodaiEnvironment }>("POST", "/v1/environments", {
      project_id: projectId,
      name,
      provider: "byo",
    });
    return r.environment;
  }

  async mintEnrollToken(environmentId: string): Promise<EnrollToken> {
    return this.call<EnrollToken>("POST", `/v1/environments/${encodeURIComponent(environmentId)}/enroll-token`);
  }

  async getEnvironment(environmentId: string): Promise<CodaiEnvironment> {
    const r = await this.call<{ environment: CodaiEnvironment }>("GET", `/v1/environments/${encodeURIComponent(environmentId)}`);
    return r.environment;
  }

  /** Cheapest authenticated call — used by the settings "Test connection" button. */
  async ping(): Promise<{ projects: number }> {
    return { projects: (await this.listProjects()).length };
  }
}

export const ENROLLED_STATES: ReadonlySet<string> = new Set(["enrolling", "running"]);
