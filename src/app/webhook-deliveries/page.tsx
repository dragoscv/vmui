import "server-only";
import { Button, PageHeader, PageSection, PageShell, Stat, StatGrid } from "@/components/ui";
import { WebhookDeliveriesTable } from "@/components/webhooks-ops/webhook-deliveries-table";
import { db } from "@/lib/db";
import { webhookDeliveries } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { CheckCircle2, Clock, Send, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WebhookDeliveriesPage() {
  const t = await getTranslations("ops.deliveries");
  const rows = await db.select().from(webhookDeliveries).orderBy(desc(webhookDeliveries.createdAt)).limit(200);
  const counts: Record<(typeof rows)[number]["status"], number> = { queued: 0, delivering: 0, ok: 0, failed: 0 };
  for (const r of rows) counts[r.status] += 1;

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<Send />}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/instance-webhooks">{t("manageWebhooks")}</Link>
          </Button>
        }
      />

      <StatGrid cols={4}>
        <Stat label={t("status.queued")} value={counts.queued} icon={<Clock />} tone="info" />
        <Stat label={t("status.delivering")} value={counts.delivering} icon={<Send />} tone="warning" />
        <Stat label={t("status.ok")} value={counts.ok} icon={<CheckCircle2 />} tone="success" />
        <Stat label={t("status.failed")} value={counts.failed} icon={<XCircle />} tone={counts.failed > 0 ? "danger" : "default"} />
      </StatGrid>

      <PageSection title={t("listTitle")} description={t("listDescription", { count: rows.length })}>
        <WebhookDeliveriesTable rows={rows} />
      </PageSection>
    </PageShell>
  );
}
