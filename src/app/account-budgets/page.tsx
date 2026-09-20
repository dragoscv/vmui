import "server-only";
import { AccountBudgetsTable } from "@/components/cloud/account-budgets-table";
import { Button, EmptyState, PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { accountBudgets, cloudAccounts, snapshotHistory } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AccountBudgetsPage() {
  const [t, accs, budgets, recentSnaps] = await Promise.all([
    getTranslations("cloud.accountBudgets"),
    db.select().from(cloudAccounts),
    db.select().from(accountBudgets),
    db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, new Date(Date.now() - 24 * 3600_000))),
  ]);
  const budgetMap = new Map(budgets.map((b) => [b.accountId, b]));
  const projected = new Map<string, number>();
  for (const s of recentSnaps) {
    const cur = projected.get(s.accountId) ?? 0;
    if (s.hourlyUsd > cur) projected.set(s.accountId, s.hourlyUsd);
  }

  const rows = accs.map((a) => {
    const b = budgetMap.get(a.id);
    return {
      accountId: a.id,
      name: a.name,
      provider: a.provider,
      projectedMonthly: (projected.get(a.id) ?? 0) * 24 * 30,
      cap: b ? b.monthlyUsd : null,
      alertedAt: b?.alertedAt ? b.alertedAt.toISOString() : null,
    };
  });

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Wallet />} />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Wallet />}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button asChild>
              <Link href="/accounts/new">{t("empty.action")}</Link>
            </Button>
          }
        />
      ) : (
        <AccountBudgetsTable rows={rows} />
      )}
    </PageShell>
  );
}
