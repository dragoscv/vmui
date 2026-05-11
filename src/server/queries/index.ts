import "server-only";
import { and, desc, eq, gte, like, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts, instances } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { priceInstances, type PricedRow } from "@/lib/pricing";
import { redactQuiet } from "@/lib/secret-redactor";

export async function listAccounts() {
  const rows = await db.select().from(cloudAccounts).orderBy(desc(cloudAccounts.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    provider: r.provider,
    defaultRegion: r.defaultRegion,
    regions: r.regions ? (safeJsonArray(r.regions) ?? null) : null,
    createdAt: r.createdAt,
    monthlyBudgetUsd: r.monthlyBudgetUsd ?? null,
    meta: r.metadataEnc
      ? decryptJSON<{ accountId: string; label: string }>(r.metadataEnc)
      : null,
  }));
}

function safeJsonArray(raw: string): string[] | null {
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.every((s) => typeof s === "string")) return v as string[];
  } catch {
    // ignore
  }
  return null;
}

export async function listInstances() {
  return db.select().from(instances).orderBy(desc(instances.lastSyncedAt));
}

/**
 * Same as listInstances() plus a price map keyed by instance id. Use for
 * pages that render hourly cost pills or monthly burn estimates.
 */
export async function listInstancesWithPrices(): Promise<{
  instances: Awaited<ReturnType<typeof listInstances>>;
  priceMap: Record<string, PricedRow>;
}> {
  const list = await listInstances();
  const priceMap = await priceInstances(
    list.map((i) => ({
      id: i.id,
      provider: i.provider,
      region: i.region,
      instanceType: i.instanceType,
      platform: i.platform,
      accountId: i.accountId,
    })),
  );
  return { instances: list, priceMap };
}

export async function getInstanceById(id: string) {
  const rows = await db.select().from(instances).where(eq(instances.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listAuditLog(limit = 25) {
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}

export interface AuditLogFilter {
  status?: "ok" | "error";
  /** Substring match on action (case-insensitive). */
  action?: string;
  /** Substring match on action OR target OR message (case-insensitive). */
  search?: string;
  accountId?: string;
  /** Only return rows newer than this ISO time / Date. */
  since?: Date;
  /** Cursor for pagination — only return rows with id < cursor. */
  cursor?: number;
  limit?: number;
}

export interface AuditLogPage {
  rows: typeof auditLog.$inferSelect[];
  nextCursor: number | null;
  total: number;
}

/**
 * Cursor-paginated audit log query. All filters compose with AND and run in
 * SQL — the table can grow large in long-running installs. `nextCursor` is
 * the lowest id of the returned page; pass it back as `cursor` to get the
 * next page. SQLite `LIKE` is case-insensitive for ASCII by default.
 */
export async function listAuditLogFiltered(filter: AuditLogFilter = {}): Promise<AuditLogPage> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const conds = [];
  if (filter.status) conds.push(eq(auditLog.status, filter.status));
  if (filter.accountId) conds.push(eq(auditLog.accountId, filter.accountId));
  if (filter.cursor != null) conds.push(lt(auditLog.id, filter.cursor));
  if (filter.since) conds.push(gte(auditLog.createdAt, filter.since));
  if (filter.action) {
    conds.push(like(auditLog.action, `%${escapeLike(filter.action)}%`));
  }
  if (filter.search) {
    const pat = `%${escapeLike(filter.search)}%`;
    conds.push(
      or(
        like(auditLog.action, pat),
        like(auditLog.target, pat),
        like(auditLog.message, pat),
      )!,
    );
  }
  const whereClause = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select()
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;

  // Total matching rows (without cursor) — only run on first page to avoid
  // an extra count on every "load more" click.
  let total = page.length;
  if (filter.cursor == null) {
    const totalConds = conds.filter((_, i) => {
      // strip the cursor condition (not present here, but safety)
      return true;
    });
    const [c] = await db
      .select({ c: sql<number>`count(*)` })
      .from(auditLog)
      .where(totalConds.length > 0 ? and(...totalConds) : undefined);
    total = c?.c ?? page.length;
  }

  return { rows: redactAuditRows(page), nextCursor, total };
}

function redactAuditRows<T extends { message: string | null }>(rows: T[]): T[] {
  return rows.map((r) => (r.message ? { ...r, message: redactQuiet(r.message) } : r));
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Last 24h count split by status — used by activity page header chip. */
export async function auditLogStats24h(): Promise<{ ok: number; error: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ status: auditLog.status, c: sql<number>`count(*)` })
    .from(auditLog)
    .where(gte(auditLog.createdAt, since))
    .groupBy(auditLog.status);
  let ok = 0;
  let err = 0;
  for (const r of rows) {
    if (r.status === "ok") ok = r.c;
    else if (r.status === "error") err = r.c;
  }
  return { ok, error: err };
}
