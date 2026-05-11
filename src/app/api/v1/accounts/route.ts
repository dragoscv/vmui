import "server-only";

import { db } from "@/lib/db";
import { cloudAccounts } from "@/lib/db/schema";
import { validateApiKey } from "@/lib/api-auth";

export async function GET(req: Request) {
  const auth = await validateApiKey(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const rows = await db.select().from(cloudAccounts);
  return Response.json({
    ok: true,
    count: rows.length,
    items: rows.map((a) => ({
      id: a.id,
      provider: a.provider,
      name: a.name,
      defaultRegion: a.defaultRegion,
      regions: a.regions ? JSON.parse(a.regions) : null,
      monthlyBudgetUsd: a.monthlyBudgetUsd,
      createdAt: a.createdAt,
    })),
  });
}
