import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { validateApiKey, requireApiRole } from "@/lib/api-auth";
import { executeInstanceAction } from "@/server/actions/instances";

const VALID = new Set(["start", "stop", "reboot", "terminate"]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!VALID.has(action)) {
    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
  const auth = requireApiRole(await validateApiKey(req), "operator");
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const row = await db.query.instances.findFirst({ where: eq(instances.id, id) });
  if (!row) return Response.json({ error: "Instance not found" }, { status: 404 });

  const result = await executeInstanceAction(action as "start" | "stop" | "reboot" | "terminate", {
    accountId: row.accountId,
    region: row.region,
    providerInstanceId: row.providerInstanceId,
  });
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 400 });
  return Response.json({ ok: true });
}
