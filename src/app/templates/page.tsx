import "server-only";
import { TemplatesGrid } from "@/components/templates/templates-grid";
import { PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { cloudAccounts, launchTemplates } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { LayoutTemplate } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const [tpls, accs, t] = await Promise.all([
    db.select().from(launchTemplates).orderBy(desc(launchTemplates.createdAt)),
    db.select().from(cloudAccounts),
    getTranslations("ops.templates"),
  ]);
  const accMap = new Map(accs.map((a) => [a.id, a.name]));
  const cards = tpls.map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    accountId: tpl.accountId,
    accountName: accMap.get(tpl.accountId) ?? tpl.accountId.slice(0, 8),
    region: tpl.region,
    instanceType: tpl.instanceType,
    platform: tpl.platform,
    configJson: tpl.configJson,
    createdAt: tpl.createdAt,
  }));

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<LayoutTemplate />} badge={cards.length > 0 ? <span className="text-xs text-fg-muted">{t("count", { count: cards.length })}</span> : undefined} />
      <TemplatesGrid templates={cards} />
    </PageShell>
  );
}
