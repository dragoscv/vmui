import { TagBudgetForm } from "@/components/cloud/tag-budget-form";
import { TagBudgetsTable } from "@/components/cloud/tag-budgets-table";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { tagBudgets } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { PiggyBank } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const [t, rows] = await Promise.all([getTranslations("cloud.budgets"), db.select().from(tagBudgets).orderBy(desc(tagBudgets.createdAt))]);

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<PiggyBank />} />

      <PageSection title={t("newBudget")} description={t("newBudgetDescription")}>
        <TagBudgetForm />
      </PageSection>

      {rows.length === 0 ? (
        <EmptyState icon={<PiggyBank />} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <PageSection title={t("section")}>
          <TagBudgetsTable
            rows={rows.map((r) => ({
              id: r.id,
              tagKey: r.tagKey,
              tagValue: r.tagValue,
              monthlyUsd: r.monthlyUsd,
              lastObservedUsd: r.lastObservedUsd,
              exceeded: Boolean(r.exceeded),
            }))}
          />
        </PageSection>
      )}
    </PageShell>
  );
}
