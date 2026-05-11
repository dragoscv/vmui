import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitSources } from "@/lib/db/schema";
import { validateApiKey } from "@/lib/api-auth";

export async function GET(req: Request) {
  const auth = await validateApiKey(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const rows = await db
    .select({
      id: gitSources.id,
      name: gitSources.name,
      url: gitSources.url,
      branch: gitSources.branch,
      authType: gitSources.authType,
      composeGlob: gitSources.composeGlob,
      targetInstanceId: gitSources.targetInstanceId,
      pollSeconds: gitSources.pollSeconds,
      enabled: gitSources.enabled,
      lastCommit: gitSources.lastCommit,
      lastSyncedAt: gitSources.lastSyncedAt,
      lastError: gitSources.lastError,
      createdAt: gitSources.createdAt,
    })
    .from(gitSources)
    .orderBy(desc(gitSources.createdAt));
  return Response.json({ ok: true, count: rows.length, items: rows });
}
