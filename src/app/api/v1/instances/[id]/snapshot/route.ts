import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { validateApiKey, requireApiRole } from "@/lib/api-auth";
import { createInstanceSnapshotAction } from "@/server/actions/snapshots";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = requireApiRole(await validateApiKey(req), "operator");
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const row = await db.query.instances.findFirst({ where: eq(instances.id, id) });
  if (!row) return Response.json({ error: "Instance not found" }, { status: 404 });

  let label = `vmui-cli-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    const body = (await req.json().catch(() => null)) as { label?: string } | null;
    if (body && typeof body.label === "string" && body.label.trim().length > 0) {
      label = body.label.trim();
    }
  } catch {
    // body is optional
  }

  const result = await createInstanceSnapshotAction({
    accountId: row.accountId,
    providerInstanceId: row.providerInstanceId,
    region: row.region,
    label,
  });
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 400 });
  return Response.json({ ok: true, snapshotId: result.snapshotId, note: result.note });
}
