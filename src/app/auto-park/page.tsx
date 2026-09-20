import "server-only";
import { AutoParkEnableForm } from "@/components/auto-park/auto-park-enable-form";
import { AutoParkPoliciesTable, type AutoParkRow } from "@/components/auto-park/auto-park-policies-table";
import { Badge, PageHeader, PageSection, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { idleParkPolicies, instances } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { Pause } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function AutoParkPage() {
  const t = await getTranslations("ops.autoPark");
  const [policies, allInstances] = await Promise.all([
    db.select().from(idleParkPolicies).orderBy(desc(idleParkPolicies.createdAt)),
    db.select().from(instances).orderBy(instances.name),
  ]);

  const nameByKey = new Map(
    allInstances.map((i) => [`${i.accountId}|${i.providerInstanceId}`, i.displayName ?? i.name ?? null]),
  );
  const rows: AutoParkRow[] = policies.map((p) => ({
    ...p,
    instanceName: nameByKey.get(`${p.accountId}|${p.providerInstanceId}`) ?? null,
  }));
  const activeCount = rows.filter((r) => r.enabled === 1).length;

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<Pause />}
        badge={
          <Badge variant={activeCount > 0 ? "success" : "muted"} dot={activeCount > 0}>
            {t("activeBadge", { count: activeCount })}
          </Badge>
        }
      />

      <PageSection title={t("listTitle")} description={t("listDescription")}>
        <AutoParkPoliciesTable rows={rows} />
      </PageSection>

      <PageSection id="auto-park-form" title={t("formTitle")} description={t("formDescription")}>
        <AutoParkEnableForm
          targets={allInstances.map((i) => ({
            accountId: i.accountId,
            providerInstanceId: i.providerInstanceId,
            name: i.displayName ?? i.name ?? i.providerInstanceId,
            region: i.region,
          }))}
        />
      </PageSection>
    </PageShell>
  );
}
