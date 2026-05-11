import "server-only";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { lt } from "drizzle-orm";
import { gzipSync } from "node:zlib";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { env } from "@/lib/env";

const RETENTION_DAYS = 30;

declare global {
  // eslint-disable-next-line no-var
  var __vmuiAuditRetention__: { interval: ReturnType<typeof setInterval> } | undefined;
}

/**
 * Archives audit_log rows older than RETENTION_DAYS to a gzipped JSON file
 * under <db-dir>/audit-archive/, then deletes them from the live table.
 * Runs once at boot and then daily.
 */
async function pruneAndArchive(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const old = await db.select().from(auditLog).where(lt(auditLog.createdAt, cutoff));
  if (old.length === 0) return;

  const dbPath = resolve(process.cwd(), env.VMUI_DB_PATH);
  const archiveDir = resolve(dirname(dbPath), "audit-archive");
  if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = resolve(archiveDir, `audit-${stamp}.json.gz`);
  writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(old))));

  await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff));
  console.log(`[vmui] archived ${old.length} audit rows -> ${file}`);
}

export function ensureAuditRetention(): void {
  if (typeof window !== "undefined") return;
  if (globalThis.__vmuiAuditRetention__) return;
  pruneAndArchive().catch((err) => console.error("[vmui] audit archive failed", err));
  const interval = setInterval(
    () => {
      pruneAndArchive().catch((err) => console.error("[vmui] audit archive failed", err));
    },
    24 * 60 * 60 * 1000,
  );
  if (typeof interval.unref === "function") interval.unref();
  globalThis.__vmuiAuditRetention__ = { interval };
}
