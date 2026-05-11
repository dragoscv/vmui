import { listAccounts, listAuditLogFiltered, auditLogStats24h } from "@/server/queries";
import { ActivityExplorer } from "@/components/activity/activity-explorer";
import Link from "next/link";
import { History, Download } from "lucide-react";

export const dynamic = "force-dynamic";

const RANGE_TO_MS: Record<string, number | undefined> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: undefined,
};

interface Props {
  searchParams: Promise<{
    q?: string;
    status?: string;
    account?: string;
    range?: string;
  }>;
}

export default async function ActivityPage({ searchParams }: Props) {
  const sp = await searchParams;
  const status = sp.status === "ok" || sp.status === "error" ? sp.status : undefined;
  const range = sp.range && sp.range in RANGE_TO_MS ? sp.range : "24h";
  const sinceMs = RANGE_TO_MS[range];
  const accountId = sp.account?.trim() || undefined;

  const [page, accounts, stats] = await Promise.all([
    listAuditLogFiltered({
      search: sp.q,
      status,
      accountId,
      since: sinceMs ? new Date(Date.now() - sinceMs) : undefined,
      limit: 50,
    }),
    listAccounts(),
    auditLogStats24h(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="text-sm text-muted">Operations performed by vmui — searchable, filterable, exportable.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <Link
            href="/activity/sync"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 hover:bg-white/5"
          >
            <History className="h-3.5 w-3.5" /> Sync history
          </Link>
          <a
            href="/api/audit/export"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 hover:bg-white/5"
          >
            <Download className="h-3.5 w-3.5" /> NDJSON
          </a>
          <a
            href="/api/audit/export?format=csv"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 hover:bg-white/5"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </a>
          <span>Last 24h:</span>
          <span className="rounded-full bg-[color-mix(in_oklch,var(--color-success)_20%,transparent)] px-2 py-0.5 font-mono text-[var(--color-success)]">
            {stats.ok} ok
          </span>
          <span className="rounded-full bg-[color-mix(in_oklch,var(--color-danger)_20%,transparent)] px-2 py-0.5 font-mono text-[var(--color-danger)]">
            {stats.error} error
          </span>
        </div>
      </div>
      <ActivityExplorer
        initialRows={page.rows}
        initialNextCursor={page.nextCursor}
        initialTotal={page.total}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider }))}
        initialFilters={{
          search: sp.q ?? "",
          status: status ?? "all",
          accountId: accountId ?? "all",
          range,
        }}
      />
    </div>
  );
}

