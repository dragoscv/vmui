import "server-only";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let dbOk = false;
  try {
    await db.run(sql`SELECT 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const ok = dbOk && Boolean(env.VMUI_MASTER_KEY);
  return new Response(
    JSON.stringify({
      ok,
      db: dbOk,
      masterKey: Boolean(env.VMUI_MASTER_KEY),
      uptimeSec: Math.round(process.uptime()),
      version: process.env.npm_package_version ?? "0.0.0",
      latencyMs: Date.now() - started,
      ts: Date.now(),
    }),
    {
      status: ok ? 200 : 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}
