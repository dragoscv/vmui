import "server-only";

import { requireApiRole, validateApiKey } from "@/lib/api-auth";
import { TOOL_BY_NAME, TOOLS } from "@/lib/mcp/tools";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

/**
 * MCP server (Streamable HTTP, stateless, JSON responses) exposing this house
 * and this PC as named tools to codai phone/desktop over the tailnet.
 *
 * Auth: bearer `vmui_*` API key with the operator role (Settings -> API keys).
 * Each call is audit-logged under accountId "mcp". Tools that interrupt the
 * user or act on the physical world carry `destructiveHint` so the client
 * shows an ask-card first.
 */

export const dynamic = "force-dynamic";

const PROTOCOL = "2025-03-26";

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function ok(id: Rpc["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function err(id: Rpc["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.schema, { target: "openapi-3.0", reused: "inline", io: "input" }),
    annotations: {
      title: t.name.replace(/_/g, " "),
      readOnlyHint: t.readOnly ?? false,
      destructiveHint: t.destructive ?? false,
      idempotentHint: t.readOnly ?? false,
      openWorldHint: false,
    },
  }));
}

async function handle(msg: Rpc, by: string): Promise<unknown | null> {
  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "vmui-home", version: "1.0.0" },
        instructions:
          "Tools control Dragos's home (Home Assistant: lights, AC, Nest Hub, ambilight, door) and his Windows PC. " +
          "Call home_devices/home_state before guessing entity ids. Ask before destructive tools (door_open, pc_action lock/sleep, vm stop/terminate).",
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: toolList() });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = TOOL_BY_NAME.get(name);
      if (!tool) return err(msg.id, -32602, `Unknown tool ${name}`);
      const parsed = tool.schema.safeParse(msg.params?.arguments ?? {});
      if (!parsed.success) {
        return ok(msg.id, { isError: true, content: [{ type: "text", text: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }] });
      }
      const r = await tool.run(parsed.data, by);
      return ok(msg.id, { isError: !r.ok, content: [{ type: "text", text: JSON.stringify(r) }] });
    }
    default:
      return err(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: NextRequest) {
  const auth = requireApiRole(await validateApiKey(req), "operator");
  if (!auth.ok) return NextResponse.json(err(null, -32000, auth.error), { status: auth.status });
  const by = `mcp:${auth.keyId}`;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(err(null, -32700, "Parse error"), { status: 400 });
  }
  const msgs = (Array.isArray(body) ? body : [body]) as Rpc[];
  const out: unknown[] = [];
  for (const m of msgs) {
    if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") {
      out.push(err((m as Rpc | undefined)?.id ?? null, -32600, "Invalid request"));
      continue;
    }
    const r = await handle(m, by);
    if (r !== null) out.push(r);
  }
  if (out.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? out : out[0]);
}

// Stateless server: no SSE stream to resume, no session to delete.
export function GET() {
  return NextResponse.json({ error: "SSE stream not supported; POST JSON-RPC" }, { status: 405 });
}
export function DELETE() {
  return new NextResponse(null, { status: 204 });
}
