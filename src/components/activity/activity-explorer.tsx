"use client";

import { useState, useTransition, useDeferredValue, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Download, CheckCircle2, XCircle, Filter, Loader2, Radio, List, GitCommitVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { loadAuditPageAction } from "@/server/actions/activity";
import { toast } from "sonner";

type Row = {
  id: number;
  accountId: string | null;
  action: string;
  target: string | null;
  status: "ok" | "error";
  message: string | null;
  createdAt: Date;
};

type Account = { id: string; name: string; provider: string };
type StatusFilter = "all" | "ok" | "error";
type RangeFilter = "1h" | "24h" | "7d" | "30d" | "all";

const RANGES: { id: RangeFilter; label: string; ms: number | undefined }[] = [
  { id: "1h", label: "1h", ms: 60 * 60 * 1000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { id: "all", label: "All", ms: undefined },
];

interface Props {
  initialRows: Row[];
  initialNextCursor: number | null;
  initialTotal: number;
  accounts: Account[];
  initialFilters: {
    search: string;
    status: StatusFilter;
    accountId: string;
    range: string;
  };
}

export function ActivityExplorer({
  initialRows,
  initialNextCursor,
  initialTotal,
  accounts,
  initialFilters,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [search, setSearch] = useState(initialFilters.search);
  const [status, setStatus] = useState<StatusFilter>(
    (initialFilters.status as StatusFilter) ?? "all",
  );
  const [accountId, setAccountId] = useState(initialFilters.accountId);
  const [range, setRange] = useState<RangeFilter>(
    (initialFilters.range as RangeFilter) ?? "24h",
  );
  const deferredSearch = useDeferredValue(search);

  const [rows, setRows] = useState<Row[]>(initialRows);
  const [nextCursor, setNextCursor] = useState<number | null>(initialNextCursor);
  const [total, setTotal] = useState(initialTotal);
  const [loadingMore, setLoadingMore] = useState(false);
  const [live, setLive] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "timeline">("list");

  useEffect(() => {
    if (!live || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/events");
    const onAudit = (raw: MessageEvent) => {
      try {
        const ev = JSON.parse(raw.data) as Row;
        // Apply current client-side filters before prepending. Date arrives as string.
        const created = new Date(ev.createdAt);
        const sinceMs = RANGES.find((r) => r.id === range)?.ms;
        if (sinceMs && Date.now() - created.getTime() > sinceMs) return;
        if (status !== "all" && ev.status !== status) return;
        if (accountId !== "all" && ev.accountId !== accountId) return;
        if (deferredSearch) {
          const hay = `${ev.action} ${ev.target ?? ""} ${ev.message ?? ""}`.toLowerCase();
          if (!hay.includes(deferredSearch.toLowerCase())) return;
        }
        setRows((prev) => {
          if (prev.some((r) => r.id === ev.id)) return prev;
          return [{ ...ev, createdAt: created }, ...prev];
        });
        setTotal((t) => t + 1);
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("audit", onAudit);
    return () => {
      es.removeEventListener("audit", onAudit);
      es.close();
    };
  }, [live, range, status, accountId, deferredSearch]);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (deferredSearch) sp.set("q", deferredSearch);
    if (status !== "all") sp.set("status", status);
    if (accountId !== "all") sp.set("account", accountId);
    if (range !== "24h") sp.set("range", range);
    startTransition(() => {
      router.replace(`/activity${sp.toString() ? `?${sp.toString()}` : ""}`, { scroll: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredSearch, status, accountId, range]);

  useEffect(() => {
    setRows(initialRows);
    setNextCursor(initialNextCursor);
    setTotal(initialTotal);
  }, [initialRows, initialNextCursor, initialTotal]);

  const loadMore = useCallback(async () => {
    if (nextCursor == null || loadingMore) return;
    setLoadingMore(true);
    const res = await loadAuditPageAction({
      search: deferredSearch || undefined,
      status: status === "all" ? undefined : status,
      accountId: accountId === "all" ? undefined : accountId,
      sinceMs: RANGES.find((r) => r.id === range)?.ms,
      cursor: nextCursor,
      limit: 50,
    });
    setLoadingMore(false);
    if (!res.ok) {
      toast.error("Failed to load more", { description: res.error });
      return;
    }
    setRows((prev) => [...prev, ...(res.page.rows as unknown as Row[])]);
    setNextCursor(res.page.nextCursor);
  }, [nextCursor, loadingMore, deferredSearch, status, accountId, range]);

  const exportCsv = () => {
    const header = "id,createdAt,status,accountId,action,target,message";
    const escape = (v: string | number | Date | null) => {
      if (v === null || v === undefined) return "";
      const s = v instanceof Date ? v.toISOString() : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = [
      header,
      ...rows.map((r) =>
        [r.id, r.createdAt, r.status, r.accountId, r.action, r.target, r.message].map(escape).join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vmui-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    setAccountId("all");
    setRange("24h");
  };
  const hasActiveFilters =
    search !== "" || status !== "all" || accountId !== "all" || range !== "24h";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions, targets, messages…"
            className="pl-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:bg-white/10 hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5">
          {(["all", "ok", "error"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                status === s ? "bg-white/10 text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                range === r.id ? "bg-white/10 text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {accounts.length > 0 && (
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
          >
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.provider}
              </option>
            ))}
          </select>
        )}

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}

        <Button variant="ghost" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="h-4 w-4" /> CSV
        </Button>

        <div className="flex items-center rounded-md border border-[var(--color-border)] p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            aria-pressed={viewMode === "list"}
            className={`rounded p-1.5 transition ${viewMode === "list" ? "bg-white/10 text-fg" : "text-muted hover:text-fg"}`}
            title="List view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("timeline")}
            aria-pressed={viewMode === "timeline"}
            className={`rounded p-1.5 transition ${viewMode === "timeline" ? "bg-white/10 text-fg" : "text-muted hover:text-fg"}`}
            title="Timeline view"
          >
            <GitCommitVertical className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setLive((v) => !v)}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
            live
              ? "border-[var(--color-success)]/40 bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)]"
              : "border-[var(--color-border)] text-muted hover:text-fg"
          }`}
          title={live ? "Streaming new events as they arrive" : "Click to start live tail"}
        >
          <Radio className={`h-3.5 w-3.5 ${live ? "animate-pulse" : ""}`} />
          {live ? "Live" : "Tail"}
        </button>
      </div>

      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          Showing <strong className="text-fg">{rows.length}</strong> of{" "}
          <strong className="text-fg">{total}</strong> matching events
        </span>
        {pending && <span>Updating…</span>}
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--color-border)] py-12 text-center text-muted">
          <Filter className="mx-auto mb-2 h-6 w-6" />
          No events match these filters.
        </div>
      ) : viewMode === "timeline" ? (
        <TimelineView rows={rows} />
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
          {rows.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-white/5">
              {e.status === "ok" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-success)]" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-[var(--color-danger)]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{e.action}</span>
                  {e.accountId && (
                    <Badge variant="info" className="text-[10px]">
                      {e.accountId.slice(0, 6)}
                    </Badge>
                  )}
                </div>
                {e.message && <div className="mt-0.5 truncate text-xs text-muted">{e.message}</div>}
              </div>
              {e.target && (
                <code className="hidden max-w-[180px] truncate font-mono text-[11px] text-muted sm:inline">
                  {e.target}
                </code>
              )}
              <time
                dateTime={new Date(e.createdAt).toISOString()}
                className="shrink-0 text-xs text-muted"
              >
                {new Date(e.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}

      {nextCursor != null && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </>
            ) : (
              <>Load 50 more</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function TimelineView({ rows }: { rows: Row[] }) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const d = new Date(r.createdAt);
    const key = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  return (
    <div className="relative space-y-6">
      {[...groups.entries()].map(([day, entries]) => (
        <section key={day}>
          <header className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {day}
            <span className="ml-2 font-mono normal-case text-[10px] opacity-70">
              {entries.length} event{entries.length === 1 ? "" : "s"}
            </span>
          </header>
          <ol className="relative space-y-2 border-l border-[var(--color-border)] pl-5">
            {entries.map((e) => {
              const ok = e.status === "ok";
              return (
                <li key={e.id} className="relative">
                  <span
                    className={`absolute -left-[22px] top-1.5 inline-flex h-3 w-3 items-center justify-center rounded-full ring-2 ring-[var(--color-bg)] ${
                      ok
                        ? "bg-[var(--color-success)]"
                        : "bg-[var(--color-danger)]"
                    }`}
                    aria-hidden
                  />
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-medium">{e.action}</span>
                    {e.target && (
                      <code className="truncate font-mono text-[11px] text-muted">{e.target}</code>
                    )}
                    <time
                      dateTime={new Date(e.createdAt).toISOString()}
                      className="ml-auto shrink-0 text-[11px] text-muted"
                    >
                      {new Date(e.createdAt).toLocaleTimeString()}
                    </time>
                  </div>
                  {e.message && (
                    <div className="mt-0.5 truncate text-xs text-muted">{e.message}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
