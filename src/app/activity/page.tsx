import { ActivityExplorer } from "@/components/activity/activity-explorer";
import { Badge, Button, PageHeader, PageShell, Stat, StatGrid } from "@/components/ui";
import { auditLogStats24h, listAccounts, listAuditLogFiltered } from "@/server/queries";
import { CheckCircle2, Download, History, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

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
  const t = await getTranslations("observe.activity");
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
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<History />}
        badge={<Badge variant="muted">{t("eventCount", { count: page.total })}</Badge>}
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/activity/sync">
                <History className="size-4" aria-hidden /> {t("syncHistory")}
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="/api/audit/export">
                <Download className="size-4" aria-hidden /> {t("exportNdjson")}
              </a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="/api/audit/export?format=csv">
                <Download className="size-4" aria-hidden /> {t("exportCsv")}
              </a>
            </Button>
          </>
        }
      />
      <StatGrid cols={2}>
        <Stat label={t("stats.ok24h")} value={stats.ok} tone="success" icon={<CheckCircle2 />} />
        <Stat label={t("stats.error24h")} value={stats.error} tone={stats.error > 0 ? "danger" : "default"} icon={<XCircle />} />
      </StatGrid>
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
    </PageShell>
  );
}

