import "server-only";
import { rawSqlite } from "@/lib/db";
import { redactQuiet } from "@/lib/secret-redactor";

export interface LogSearchRow {
  id: number;
  createdAt: Date;
  accountId: string | null;
  action: string;
  target: string;
  status: string;
  message: string | null;
  snippet: string;
}

export interface LogSearchFacets {
  status: { value: string; count: number }[];
  action: { value: string; count: number }[];
  account: { value: string; count: number }[];
}

export interface LogSearchResult {
  rows: LogSearchRow[];
  total: number;
  facets: LogSearchFacets;
  matched: boolean;
}

export interface LogSearchInput {
  q?: string;
  status?: string;
  action?: string;
  accountId?: string;
  limit?: number;
  cursor?: number;
}

/**
 * Sanitize a user-typed query into something FTS5 will accept. Strips
 * special operators that crash MATCH (unbalanced quotes, dangling NEAR/AND)
 * and wraps each whitespace-delimited token as a prefix match.
 */
function buildMatchExpr(q: string): string {
  const tokens = q
    .toLowerCase()
    .replace(/["'`]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9_\-:.@/]/g, ""))
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `${t}*`).join(" AND ");
}

export async function searchLogs(input: LogSearchInput = {}): Promise<LogSearchResult> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
  const cursor = input.cursor ?? 0;
  const q = (input.q ?? "").trim();
  const match = q ? buildMatchExpr(q) : "";
  const usedMatch = match.length > 0;

  const params: Array<string | number> = [];
  let baseFrom: string;
  if (usedMatch) {
    baseFrom = `audit_log_fts JOIN audit_log a ON a.id = audit_log_fts.rowid WHERE audit_log_fts MATCH ?`;
    params.push(match);
  } else {
    baseFrom = `audit_log a WHERE 1=1`;
  }
  const filters: string[] = [];
  if (input.status) {
    filters.push(`a.status = ?`);
    params.push(input.status);
  }
  if (input.action) {
    filters.push(`a.action = ?`);
    params.push(input.action);
  }
  if (input.accountId) {
    filters.push(`a.account_id = ?`);
    params.push(input.accountId);
  }
  const whereExtra = filters.length > 0 ? ` AND ${filters.join(" AND ")}` : "";

  const cursorClause = cursor > 0 ? ` AND a.id < ${Number(cursor)}` : "";

  const selectCols = usedMatch
    ? `a.id, a.created_at, a.account_id, a.action, a.target, a.status, a.message,
       snippet(audit_log_fts, 3, '<mark>', '</mark>', '…', 12) as snippet`
    : `a.id, a.created_at, a.account_id, a.action, a.target, a.status, a.message,
       '' as snippet`;

  const listSql = `SELECT ${selectCols} FROM ${baseFrom}${whereExtra}${cursorClause} ORDER BY a.id DESC LIMIT ${limit + 1}`;
  const rows = rawSqlite.prepare(listSql).all(...params) as Array<{
    id: number;
    created_at: number;
    account_id: string | null;
    action: string;
    target: string;
    status: string;
    message: string | null;
    snippet: string;
  }>;

  const countSql = `SELECT COUNT(*) as c FROM ${baseFrom}${whereExtra}`;
  const countRow = rawSqlite.prepare(countSql).get(...params) as { c: number };
  const total = countRow?.c ?? 0;

  const facetSql = (col: "status" | "action" | "account_id") =>
    `SELECT a.${col} as v, COUNT(*) as c FROM ${baseFrom}${whereExtra} GROUP BY a.${col} ORDER BY c DESC LIMIT 12`;
  const statusFacet = rawSqlite.prepare(facetSql("status")).all(...params) as Array<{ v: string; c: number }>;
  const actionFacet = rawSqlite.prepare(facetSql("action")).all(...params) as Array<{ v: string; c: number }>;
  const accountFacet = rawSqlite.prepare(facetSql("account_id")).all(...params) as Array<{ v: string | null; c: number }>;

  const page = rows.slice(0, limit).map((r) => ({
    id: r.id,
    createdAt: new Date(r.created_at * 1000),
    accountId: r.account_id,
    action: r.action,
    target: r.target,
    status: r.status,
    message: r.message ? redactQuiet(r.message) : null,
    snippet: r.snippet,
  }));

  return {
    rows: page,
    total,
    matched: usedMatch,
    facets: {
      status: statusFacet.filter((r) => r.v).map((r) => ({ value: r.v, count: r.c })),
      action: actionFacet.filter((r) => r.v).map((r) => ({ value: r.v, count: r.c })),
      account: accountFacet.filter((r) => r.v).map((r) => ({ value: r.v as string, count: r.c })),
    },
  };
}
