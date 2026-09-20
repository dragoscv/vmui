import { LogSearch } from "@/components/activity/log-search";
import { Badge, PageHeader, PageShell, SkeletonTable } from "@/components/ui";
import { listAccounts } from "@/server/queries";
import { searchLogs } from "@/server/queries/logs";
import { FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ q?: string; status?: string; action?: string; account?: string; cursor?: string }>;
}

export default async function LogsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const t = await getTranslations("observe.logs");
  const q = sp.q ?? "";
  const cursor = sp.cursor ? Number(sp.cursor) : undefined;

  const [result, accounts] = await Promise.all([
    searchLogs({ q, status: sp.status, action: sp.action, accountId: sp.account, cursor, limit: PAGE_SIZE }),
    listAccounts(),
  ]);

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<FileText />}
        badge={<Badge variant="muted">{t("matches", { count: result.total })}</Badge>}
      />
      <Suspense fallback={<SkeletonTable rows={8} cols={3} />}>
        <LogSearch
          rows={result.rows}
          total={result.total}
          facets={result.facets}
          matched={result.matched}
          query={{ q, status: sp.status, action: sp.action, account: sp.account }}
          accountNames={Object.fromEntries(accounts.map((a) => [a.id, a.name]))}
          pageSize={PAGE_SIZE}
        />
      </Suspense>
    </PageShell>
  );
}
