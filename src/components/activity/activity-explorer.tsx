"use client";

import { useContextRail } from "@/components/nav/context-rail";
import { Badge, Button, DataTable, EmptyState, Input, ToggleGroup, type ColumnDef, type ToggleOption } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { loadAuditPageAction } from "@/server/actions/activity";
import { CheckCircle2, Download, Filter, Radio, Search, X, XCircle } from "lucide-react";
import { motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";

export type ActivityRow = {
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

const RANGE_MS: Record<RangeFilter, number | undefined> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: undefined,
};

interface Props {
  initialRows: ActivityRow[];
  initialNextCursor: number | null;
  initialTotal: number;
  accounts: Account[];
  initialFilters: { search: string; status: StatusFilter; accountId: string; range: string };
}

export function ActivityExplorer({ initialRows, initialNextCursor, initialTotal, accounts, initialFilters }: Props) {
  const t = useTranslations("observe.activity");
  const tc = useTranslations("common");
  const format = useFormatter();

  const [search, setSearch] = React.useState(initialFilters.search);
  const [status, setStatus] = React.useState<StatusFilter>(initialFilters.status);
  const [accountId, setAccountId] = React.useState(initialFilters.accountId || "all");
  const [range, setRange] = React.useState<RangeFilter>((initialFilters.range as RangeFilter) || "24h");
  const deferredSearch = React.useDeferredValue(search);

  const [rows, setRows] = React.useState<ActivityRow[]>(initialRows);
  const [nextCursor, setNextCursor] = React.useState<number | null>(initialNextCursor);
  const [total, setTotal] = React.useState(initialTotal);
  const [loading, setLoading] = React.useState(false);
  const [live, setLive] = React.useState(false);
  const [detail, setDetail] = React.useState<ActivityRow | null>(null);

  const statusOptions: ToggleOption<StatusFilter>[] = [
    { value: "all", label: tc("all") },
    { value: "ok", label: t("status.ok") },
    { value: "error", label: t("status.error") },
  ];
  const rangeOptions: ToggleOption<RangeFilter>[] = (Object.keys(RANGE_MS) as RangeFilter[]).map((id) => ({
    value: id,
    label: t(`range.${id}`),
  }));

  const reload = React.useCallback(
    async (cursor?: number) => {
      setLoading(true);
      const res = await loadAuditPageAction({
        search: deferredSearch || undefined,
        status: status === "all" ? undefined : status,
        accountId: accountId === "all" ? undefined : accountId,
        sinceMs: RANGE_MS[range],
        cursor,
        limit: 50,
      });
      setLoading(false);
      if (!res.ok) {
        toast.error(t("loadFailed"));
        return;
      }
      const page = res.page.rows as unknown as ActivityRow[];
      setRows((prev) => (cursor ? [...prev, ...page] : page));
      setNextCursor(res.page.nextCursor);
      setTotal(res.page.total);
    },
    [deferredSearch, status, accountId, range, t],
  );

  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void reload();
  }, [reload]);

  React.useEffect(() => {
    if (!live || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/events");
    const onAudit = (raw: MessageEvent<string>) => {
      try {
        const ev = JSON.parse(raw.data) as ActivityRow;
        const created = new Date(ev.createdAt);
        const sinceMs = RANGE_MS[range];
        if (sinceMs && Date.now() - created.getTime() > sinceMs) return;
        if (status !== "all" && ev.status !== status) return;
        if (accountId !== "all" && ev.accountId !== accountId) return;
        if (deferredSearch) {
          const hay = `${ev.action} ${ev.target ?? ""} ${ev.message ?? ""}`.toLowerCase();
          if (!hay.includes(deferredSearch.toLowerCase())) return;
        }
        setRows((prev) => (prev.some((r) => r.id === ev.id) ? prev : [{ ...ev, createdAt: created }, ...prev]));
        setTotal((n) => n + 1);
      } catch {
        /* malformed frame */
      }
    };
    es.addEventListener("audit", onAudit);
    return () => {
      es.removeEventListener("audit", onAudit);
      es.close();
    };
  }, [live, range, status, accountId, deferredSearch]);

  const exportCsv = () => {
    const escape = (v: string | number | Date | null) => {
      if (v === null) return "";
      const s = v instanceof Date ? v.toISOString() : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = [
      "id,createdAt,status,accountId,action,target,message",
      ...rows.map((r) => [r.id, r.createdAt, r.status, r.accountId, r.action, r.target, r.message].map(escape).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
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
  const hasFilters = search !== "" || status !== "all" || accountId !== "all" || range !== "24h";

  const columns: ColumnDef<ActivityRow>[] = React.useMemo(
    () => [
      {
        id: "createdAt",
        header: t("columns.when"),
        cell: ({ row }) => (
          <time dateTime={new Date(row.original.createdAt).toISOString()} className="whitespace-nowrap text-xs text-fg-muted">
            {format.dateTime(new Date(row.original.createdAt), { dateStyle: "short", timeStyle: "medium" })}
          </time>
        ),
      },
      {
        id: "action",
        header: t("columns.action"),
        cell: ({ row }) => <span className="block max-w-[16rem] truncate font-medium">{row.original.action}</span>,
      },
      {
        id: "target",
        header: t("columns.target"),
        cell: ({ row }) => (
          <code className="block min-w-0 max-w-[14rem] truncate font-mono text-xs text-fg-muted">{row.original.target ?? "—"}</code>
        ),
      },
      {
        id: "status",
        header: t("columns.status"),
        cell: ({ row }) => (
          <Badge variant={row.original.status === "ok" ? "success" : "danger"}>
            {row.original.status === "ok" ? t("status.ok") : t("status.error")}
          </Badge>
        ),
      },
      {
        id: "message",
        header: t("columns.message"),
        cell: ({ row }) => <span className="block max-w-[22rem] truncate text-xs text-fg-muted">{row.original.message ?? "—"}</span>,
      },
    ],
    [t, format],
  );

  const summary = (
    <FiltersSummary
      total={total}
      shown={rows.length}
      status={status}
      range={range}
      accountName={accounts.find((a) => a.id === accountId)?.name ?? null}
      live={live}
    />
  );
  const rail = useContextRail(summary);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="pl-8"
          />
        </div>
        <ToggleGroup value={status} onValueChange={setStatus} options={statusOptions} size="sm" aria-label={t("filters.status")} />
        <ToggleGroup value={range} onValueChange={setRange} options={rangeOptions} size="sm" aria-label={t("filters.range")} />
        {accounts.length > 0 && (
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label={t("filters.account")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allAccounts")}</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {a.provider}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant={live ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setLive((v) => !v)}
          aria-pressed={live}
          className={live ? "text-success" : undefined}
        >
          <Radio className="size-4" aria-hidden /> {live ? t("live") : t("tail")}
        </Button>
        <Button variant="ghost" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="size-4" aria-hidden /> {t("exportCsv")}
        </Button>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="size-4" aria-hidden /> {tc("clear")}
          </Button>
        )}
      </div>

      <div className="2xl:hidden">{summary}</div>

      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        <DataTable
          columns={columns}
          data={rows}
          loading={loading && rows.length === 0}
          dense
          getRowId={(r) => String(r.id)}
          onRowClick={setDetail}
          pageSize={25}
          emptyState={<EmptyState compact icon={<Filter />} title={t("empty.title")} description={t("empty.description")} />}
        />
      </motion.div>

      {nextCursor !== null && (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" loading={loading} onClick={() => void reload(nextCursor)}>
            {t("loadMore")}
          </Button>
        </div>
      )}

      <Sheet open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        {detail && (
          <SheetContent
            title={detail.action}
            description={format.dateTime(new Date(detail.createdAt), { dateStyle: "full", timeStyle: "medium" })}
          >
            <dl className="space-y-3 text-sm">
              <DetailRow label={t("columns.status")}>
                <Badge variant={detail.status === "ok" ? "success" : "danger"}>
                  {detail.status === "ok" ? <CheckCircle2 className="size-3" aria-hidden /> : <XCircle className="size-3" aria-hidden />}
                  {detail.status === "ok" ? t("status.ok") : t("status.error")}
                </Badge>
              </DetailRow>
              <DetailRow label={t("columns.target")}>
                <code className="break-all font-mono text-xs">{detail.target ?? "—"}</code>
              </DetailRow>
              <DetailRow label={t("filters.account")}>
                <span className="break-all">{accounts.find((a) => a.id === detail.accountId)?.name ?? detail.accountId ?? "—"}</span>
              </DetailRow>
              <DetailRow label={t("columns.message")}>
                <p className="whitespace-pre-wrap break-words text-fg-muted">{detail.message ?? "—"}</p>
              </DetailRow>
              <DetailRow label={t("detail.id")}>
                <code className="font-mono text-xs">{detail.id}</code>
              </DetailRow>
            </dl>
          </SheetContent>
        )}
      </Sheet>

      {rail}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0">{children}</dd>
    </div>
  );
}

function FiltersSummary({
  total,
  shown,
  status,
  range,
  accountName,
  live,
}: {
  total: number;
  shown: number;
  status: StatusFilter;
  range: RangeFilter;
  accountName: string | null;
  live: boolean;
}) {
  const t = useTranslations("observe.activity");
  const tc = useTranslations("common");
  return (
    <section aria-label={t("summary.title")} className="surface p-4">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{t("summary.title")}</h2>
      <dl className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-fg-muted">{t("summary.shown")}</dt>
          <dd className="tabular-nums">{t("summary.count", { shown, total })}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-fg-muted">{t("filters.status")}</dt>
          <dd>{status === "all" ? tc("all") : status === "ok" ? t("status.ok") : t("status.error")}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-fg-muted">{t("filters.range")}</dt>
          <dd>{t(`range.${range}`)}</dd>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <dt className="shrink-0 text-fg-muted">{t("filters.account")}</dt>
          <dd className="min-w-0 truncate">{accountName ?? t("filters.allAccounts")}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-fg-muted">{t("summary.stream")}</dt>
          <dd>
            {live ? (
              <Badge variant="success" dot>
                {t("live")}
              </Badge>
            ) : (
              <Badge variant="muted">{t("paused")}</Badge>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
