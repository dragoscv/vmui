import "server-only";

import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { validateApiKey } from "@/lib/api-auth";

export async function GET(req: Request) {
  const auth = await validateApiKey(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
  const rows = await db.select().from(instances).limit(limit).offset(offset);
  return Response.json({
    ok: true,
    count: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      provider: r.provider,
      region: r.region,
      providerInstanceId: r.providerInstanceId,
      name: r.name,
      state: r.state,
      instanceType: r.instanceType,
      platform: r.platform,
      publicIp: r.publicIp,
      privateIp: r.privateIp,
      lastSyncedAt: r.lastSyncedAt,
    })),
  });
}
