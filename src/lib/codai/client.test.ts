import { describe, expect, it, vi } from "vitest";
import { CodaiApiError, CodaiClient } from "./client";

type Call = { url: string; method: string; body: unknown; auth: string | undefined };

function mockFetch(routes: Record<string, (call: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = init?.headers as Record<string, string> | undefined;
    const call: Call = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers?.authorization };
    calls.push(call);
    const key = `${method} ${new URL(url).pathname}`;
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: { message: `no route ${key}` } }), { status: 404 });
    const r = handler(call);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const P1 = { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "homelab", slug: "homelab" };
const P2 = { id: "aaaaaaaa-0000-0000-0000-000000000002", name: "brivio", slug: "brivio" };

describe("CodaiClient.ensureProject", () => {
  it("reuses a project by id", async () => {
    const { fetchImpl, calls } = mockFetch({ "GET /v1/projects": () => ({ body: { projects: [P1, P2] } }) });
    const c = new CodaiClient({ apiKey: "codai_test", fetch: fetchImpl });
    expect(await c.ensureProject({ projectId: P2.id })).toEqual(P2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.auth).toBe("Bearer codai_test");
  });

  it("reuses a project by exact name and does not POST", async () => {
    const { fetchImpl, calls } = mockFetch({
      "GET /v1/projects": () => ({ body: { projects: [P1] } }),
      "POST /v1/projects": () => ({ status: 201, body: { project: P2 } }),
    });
    const c = new CodaiClient({ apiKey: "codai_test", fetch: fetchImpl });
    expect(await c.ensureProject({ projectName: "homelab" })).toEqual(P1);
    expect(calls.map((x) => x.method)).toEqual(["GET"]);
  });

  it("creates the project when the name is unknown", async () => {
    const { fetchImpl, calls } = mockFetch({
      "GET /v1/projects": () => ({ body: { projects: [P1] } }),
      "POST /v1/projects": (call) => ({ status: 201, body: { project: { ...P2, name: (call.body as { name: string }).name } } }),
    });
    const c = new CodaiClient({ apiKey: "codai_test", fetch: fetchImpl });
    const p = await c.ensureProject({ projectName: "brivio" });
    expect(p.name).toBe("brivio");
    expect(calls[1]).toMatchObject({ method: "POST", body: { name: "brivio" } });
  });

  it("fails when an explicit project id is not visible", async () => {
    const { fetchImpl } = mockFetch({ "GET /v1/projects": () => ({ body: { projects: [P1] } }) });
    const c = new CodaiClient({ apiKey: "codai_test", fetch: fetchImpl });
    await expect(c.ensureProject({ projectId: P2.id })).rejects.toThrow(/not found/);
  });
});

describe("CodaiClient environments", () => {
  it("creates a BYO environment and mints a token against the gateway url", async () => {
    const env = { id: "bbbbbbbb-0000-0000-0000-000000000001", projectId: P1.id, name: "vm-1", slug: "homelab-ab12", state: "pending" };
    const { fetchImpl, calls } = mockFetch({
      "POST /v1/environments": () => ({ status: 201, body: { environment: env } }),
      [`POST /v1/environments/${env.id}/enroll-token`]: () => ({ status: 201, body: { token: "codai_env_x", expires_at: "2026-09-23T12:00:00Z", environment_id: env.id } }),
      [`GET /v1/environments/${env.id}`]: () => ({ body: { environment: { ...env, state: "running" }, members: [], ports: [], events: [] } }),
    });
    const c = new CodaiClient({ apiKey: "codai_test", fetch: fetchImpl, gatewayUrl: "https://gw.example/" });
    expect(await c.createByoEnvironment(P1.id, "vm-1")).toEqual(env);
    expect(calls[0]).toMatchObject({ url: "https://gw.example/v1/environments", body: { project_id: P1.id, name: "vm-1", provider: "byo" } });
    expect((await c.mintEnrollToken(env.id)).token).toBe("codai_env_x");
    expect((await c.getEnvironment(env.id)).state).toBe("running");
  });

  it("surfaces gateway errors with status + message, never the api key", async () => {
    const { fetchImpl } = mockFetch({ "GET /v1/projects": () => ({ status: 401, body: { error: { message: "invalid api key" } } }) });
    const c = new CodaiClient({ apiKey: "codai_supersecret", fetch: fetchImpl });
    const err = await c.listProjects().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodaiApiError);
    expect((err as CodaiApiError).status).toBe(401);
    expect((err as Error).message).toContain("invalid api key");
    expect((err as Error).message).not.toContain("supersecret");
  });
});
