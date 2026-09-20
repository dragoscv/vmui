import { RunbookForm } from "@/components/runbooks/runbook-form";
import { RunbooksList } from "@/components/runbooks/runbooks-list";
import { PageHeader, PageSection, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { runbooks } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { BookOpen } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function RunbooksPage() {
  const [rows, t] = await Promise.all([db.select().from(runbooks).orderBy(desc(runbooks.updatedAt)), getTranslations("ops.runbooks")]);

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<BookOpen />} />
      <RunbookForm />
      <PageSection title={t("listTitle")} description={t("count", { count: rows.length })}>
        <RunbooksList
          runbooks={rows.map((r) => ({
            id: r.id,
            title: r.title,
            body: r.body,
            accountId: r.accountId,
            providerInstanceId: r.providerInstanceId,
            updatedAt: r.updatedAt,
          }))}
        />
      </PageSection>
    </PageShell>
  );
}
