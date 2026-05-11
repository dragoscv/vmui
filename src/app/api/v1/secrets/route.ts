import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { secrets } from "@/lib/db/schema";
import { validateApiKey } from "@/lib/api-auth";

export async function GET(req: Request) {
  const auth = await validateApiKey(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  // Metadata only — values are never exposed via REST.
  const rows = await db
    .select({
      id: secrets.id,
      name: secrets.name,
      kind: secrets.kind,
      rotationDays: secrets.rotationDays,
      lastRotatedAt: secrets.lastRotatedAt,
      sealed: secrets.sealed,
      createdAt: secrets.createdAt,
    })
    .from(secrets)
    .orderBy(desc(secrets.createdAt));
  return Response.json({ ok: true, count: rows.length, items: rows });
}
