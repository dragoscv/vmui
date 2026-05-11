import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { backupPolicies } from "@/lib/db/schema";
import { validateApiKey } from "@/lib/api-auth";

export async function GET(req: Request) {
  const auth = await validateApiKey(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const rows = await db
    .select({
      id: backupPolicies.id,
      name: backupPolicies.name,
      kind: backupPolicies.kind,
      instanceId: backupPolicies.instanceId,
      cronExpr: backupPolicies.cronExpr,
      retentionJson: backupPolicies.retentionJson,
      enabled: backupPolicies.enabled,
      lastRunAt: backupPolicies.lastRunAt,
      lastStatus: backupPolicies.lastStatus,
      lastError: backupPolicies.lastError,
      createdAt: backupPolicies.createdAt,
    })
    .from(backupPolicies)
    .orderBy(desc(backupPolicies.createdAt));
  return Response.json({ ok: true, count: rows.length, items: rows });
}
