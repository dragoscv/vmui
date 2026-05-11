import "server-only";

import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { desc, like, or, and, eq } from "drizzle-orm";
import { validateApiKey } from "@/lib/api-auth";

export async function GET(req: Request) {
  const auth = await validateApiKey(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status");
  const accountId = url.searchParams.get("account")?.trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 500);

  const conds = [];
  if (q) {
    conds.push(or(like(auditLog.message, `%${q}%`), like(auditLog.action, `%${q}%`), like(auditLog.target, `%${q}%`)));
  }
  if (status === "ok" || status === "error") conds.push(eq(auditLog.status, status));
  if (accountId) conds.push(eq(auditLog.accountId, accountId));

  const whereClause = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const rows = await db
    .select()
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return Response.json({
    ok: true,
    count: rows.length,
    items: rows,
  });
}
