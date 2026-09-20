import "server-only";
import { Badge, Button, PageHeader, PageSection, PageShell } from "@/components/ui";
import { InstanceWebhookForm } from "@/components/webhooks-ops/instance-webhook-form";
import { InstanceWebhooksTable, type InstanceWebhookViewRow } from "@/components/webhooks-ops/instance-webhooks-table";
import { db } from "@/lib/db";
import { instanceWebhooks, cloudAccounts } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { Activity } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const t = await getTranslations("ops.webhooks");
  const [hooks, accs] = await Promise.all([
    db.select().from(instanceWebhooks).orderBy(desc(instanceWebhooks.createdAt)),
    db.select({ id: cloudAccounts.id, name: cloudAccounts.name }).from(cloudAccounts),
  ]);
  const nameById = new Map(accs.map((a) => [a.id, a.name]));
  const rows: InstanceWebhookViewRow[] = hooks.map((h) => ({
    ...h,
    accountName: h.accountId ? (nameById.get(h.accountId) ?? null) : null,
  }));

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t.rich("description", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}
        icon={<Activity />}
        badge={<Badge variant="muted">{t("count", { count: rows.length })}</Badge>}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/webhook-deliveries">{t("viewDeliveries")}</Link>
          </Button>
        }
      />

      <PageSection title={t("listTitle")} description={t("listDescription")}>
        <InstanceWebhooksTable rows={rows} />
      </PageSection>

      <PageSection id="webhook-form" title={t("formTitle")} description={t("formDescription")}>
        <InstanceWebhookForm accounts={accs} />
      </PageSection>
    </PageShell>
  );
}
