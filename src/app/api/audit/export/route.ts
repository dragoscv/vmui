import "server-only";
import { NextResponse } from "next/server";
import { gte, lte, and, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const untilParam = url.searchParams.get("until");
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "10000", 10) || 10000, 1), 100000);

  const conditions: SQL[] = [];
  if (sinceParam) {
    const d = new Date(sinceParam);
    if (!Number.isNaN(d.getTime())) conditions.push(gte(auditLog.createdAt, d));
  }
  if (untilParam) {
    const d = new Date(untilParam);
    if (!Number.isNaN(d.getTime())) conditions.push(lte(auditLog.createdAt, d));
  }

  const rows = await db
    .select()
    .from(auditLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .limit(limit);

  const format = (url.searchParams.get("format") ?? "ndjson").toLowerCase();

  if (format === "csv") {
    const cols = ["id", "createdAt", "accountId", "action", "target", "status", "message"] as const;
    const escape = (v: unknown): string => {
      if (v == null) return "";
      const s = v instanceof Date ? v.toISOString() : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.join(",");
    const body = rows.map((r) => cols.map((c) => escape((r as Record<string, unknown>)[c])).join(",")).join("\n");
    return new NextResponse(header + "\n" + body + "\n", {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

  return new NextResponse(ndjson, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.ndjson"`,
      "cache-control": "no-store",
    },
  });
}
