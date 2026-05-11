import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { backupJobs } from "@/lib/db/schema";
import { validateApiKey } from "@/lib/api-auth";

export async function GET(req: Request) {
  const auth = await validateApiKey(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 500);
  const rows = await db.select().from(backupJobs).orderBy(desc(backupJobs.startedAt)).limit(limit);
  return Response.json({ ok: true, count: rows.length, items: rows });
}
