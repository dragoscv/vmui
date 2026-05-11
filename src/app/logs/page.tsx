import { Suspense } from "react";
import Link from "next/link";
import { searchLogs } from "@/server/queries/logs";
import { listAccounts } from "@/server/queries";
import { Search } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    status?: string;
    action?: string;
    account?: string;
    cursor?: string;
  }>;
}

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function LogsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const status = sp.status;
  const action = sp.action;
  const accountId = sp.account;
  const cursor = sp.cursor ? Number(sp.cursor) : undefined;

  const [result, accounts] = await Promise.all([
    searchLogs({ q, status, action, accountId, cursor, limit: 50 }),
    listAccounts(),
  ]);
  const acctName = new Map(accounts.map((a) => [a.id, a.name]));

  function buildHref(patch: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = { q, status, action, account: accountId, ...patch };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v.length > 0) params.set(k, v);
    }
    const s = params.toString();
    return s ? `/logs?${s}` : `/logs`;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="text-sm text-muted">Full-text search over the audit trail.</p>
        </div>
        <div className="text-xs text-muted">{result.total.toLocaleString()} matches</div>
      </header>

      <form action="/logs" method="get" className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search action, target, message…"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-8 pr-3 text-sm"
          />
        </div>
        {status && <input type="hidden" name="status" value={status} />}
        {action && <input type="hidden" name="action" value={action} />}
        {accountId && <input type="hidden" name="account" value={accountId} />}
        <button
          type="submit"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
        >
          Search
        </button>
        {(q || status || action || accountId) && (
          <Link
            href="/logs"
            className="rounded-md px-3 py-2 text-xs text-muted hover:underline"
          >
            clear
          </Link>
        )}
      </form>

      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <aside className="space-y-4 text-sm">
          {[
            { label: "Status", items: result.facets.status, key: "status" as const },
            { label: "Action", items: result.facets.action, key: "action" as const },
            { label: "Account", items: result.facets.account, key: "account" as const },
          ].map((facet) => (
            <div key={facet.key}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{facet.label}</div>
              <ul className="space-y-0.5">
                {facet.items.length === 0 && <li className="text-xs text-muted">—</li>}
                {facet.items.map((it) => {
                  const currentKey =
                    facet.key === "status" ? status : facet.key === "action" ? action : accountId;
                  const isActive = currentKey === it.value;
                  const label = facet.key === "account" ? (acctName.get(it.value) ?? it.value.slice(0, 8)) : it.value;
                  return (
                    <li key={it.value}>
                      <Link
                        href={buildHref({
                          [facet.key]: isActive ? undefined : it.value,
                          cursor: undefined,
                        })}
                        className={`flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-[var(--color-surface-muted)] ${isActive ? "bg-[var(--color-surface-muted)] font-semibold" : ""}`}
                      >
                        <span className="truncate">{label}</span>
                        <span className="text-muted">{it.count}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </aside>

        <Suspense>
          <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">Target</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Message</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted">
                      No log entries match this query.
                    </td>
                  </tr>
                )}
                {result.rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-muted)]/50">
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted" title={r.createdAt.toISOString()}>
                      {timeAgo(r.createdAt)}
                    </td>
                    <td className="px-3 py-1.5 font-mono">{r.action}</td>
                    <td className="px-3 py-1.5 font-mono">{r.target}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.status === "ok" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      {result.matched && r.snippet ? (
                        <span
                          className="line-clamp-2 [&>mark]:bg-yellow-300/30 [&>mark]:text-yellow-100 [&>mark]:rounded-sm"
                          dangerouslySetInnerHTML={{ __html: r.snippet }}
                        />
                      ) : (
                        <span className="line-clamp-2">{r.message ?? "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.rows.length === 50 && (
              <div className="border-t border-[var(--color-border)] p-2 text-center">
                <Link
                  href={buildHref({ cursor: String(result.rows[result.rows.length - 1]!.id) })}
                  className="text-xs text-muted hover:underline"
                >
                  Load older →
                </Link>
              </div>
            )}
          </section>
        </Suspense>
      </div>
    </main>
  );
}
