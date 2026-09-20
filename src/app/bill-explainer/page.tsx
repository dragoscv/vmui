import "server-only";
import { BillMovers, InstanceTypesTable, type AccountTrend } from "@/components/cloud/bill-movers";
import { Button, PageHeader, PageSection, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { snapshotHistory, cloudAccounts, instances } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import { Receipt } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BillExplainerPage() {
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const [t, snaps, accs, allInst] = await Promise.all([
    getTranslations("cloud.billExplainer"),
    db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, since)),
    db.select().from(cloudAccounts),
    db.select().from(instances),
  ]);

  const byAccount = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const arr = byAccount.get(s.accountId) ?? [];
    if (!byAccount.has(s.accountId)) byAccount.set(s.accountId, arr);
    arr.push(s);
  }

  const trends: AccountTrend[] = [];
  for (const a of accs) {
    const items = byAccount.get(a.id);
    if (!items || items.length < 2) continue;
    items.sort((x, y) => x.capturedAt.getTime() - y.capturedAt.getTime());
    const first = items[0]!; const last = items[items.length - 1]!;
    const delta = last.hourlyUsd - first.hourlyUsd;
    const pct = first.hourlyUsd > 0 ? (delta / first.hourlyUsd) * 100 : 0;
    trends.push({
      accountId: a.id, accountName: a.name,
      startUsdPerHour: first.hourlyUsd, endUsdPerHour: last.hourlyUsd,
      deltaUsdPerHour: delta, deltaPct: pct,
      monthlyDeltaUsd: delta * 24 * 30,
      startInstances: first.runningInstances, endInstances: last.runningInstances,
    });
  }
  trends.sort((a, b) => Math.abs(b.deltaUsdPerHour) - Math.abs(a.deltaUsdPerHour));

  const instanceCounts = new Map<string, { provider: string; type: string | null; count: number }>();
  for (const i of allInst) {
    const k = `${i.provider}:${i.instanceType ?? "unknown"}`;
    const cur = instanceCounts.get(k) ?? { provider: i.provider, type: i.instanceType ?? null, count: 0 };
    cur.count += 1;
    instanceCounts.set(k, cur);
  }
  const topTypes = [...instanceCounts.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Receipt />} />

      <PageSection title={t("movers.title")} description={t("movers.description")}>
        <BillMovers trends={trends} />
      </PageSection>

      <PageSection title={t("types.title")} description={t("types.description")}>
        <InstanceTypesTable rows={topTypes} />
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <Button asChild variant="link">
            <Link href="/account-forecast">{t("links.accountForecast")}</Link>
          </Button>
          <Button asChild variant="link">
            <Link href="/cost-recos">{t("links.costRecos")}</Link>
          </Button>
        </div>
      </PageSection>
    </PageShell>
  );
}
