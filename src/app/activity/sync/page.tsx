import "server-only";
import { SyncHistoryTable, type SyncEvent } from "@/components/activity/sync-history-table";
import { Badge, Button, PageHeader, PageSection, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { cloudAccounts, syncHistory } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { ArrowLeft, History } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

function parseDetails(json: string | null): SyncEvent["details"] {
  if (!json) return {};
  try {
    return JSON.parse(json) as SyncEvent["details"];
  } catch {
    return {};
  }
}

export default async function SyncHistoryPage() {
  const t = await getTranslations("observe.sync");
  const [rows, accounts] = await Promise.all([
    db.select().from(syncHistory).orderBy(desc(syncHistory.capturedAt)).limit(200),
    db.select().from(cloudAccounts),
  ]);
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const events: SyncEvent[] = rows.map((r) => {
    const acc = accountMap.get(r.accountId);
    return {
      id: r.id,
      provider: acc?.provider ?? "—",
      accountName: acc?.name ?? r.accountId,
      region: r.region,
      capturedAt: r.capturedAt.getTime(),
      durationMs: r.durationMs,
      total: r.total,
      added: r.added,
      removed: r.removed,
      stateChanged: r.stateChanged,
      details: parseDetails(r.detailsJson),
    };
  });

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<History />}
        badge={<Badge variant="muted">{t("eventCount", { count: events.length })}</Badge>}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/activity">
              <ArrowLeft className="size-4" aria-hidden /> {t("backToActivity")}
            </Link>
          </Button>
        }
      />
      <PageSection title={t("tableTitle")} description={t("tableHint")}>
        <SyncHistoryTable rows={events} />
      </PageSection>
    </PageShell>
  );
}
