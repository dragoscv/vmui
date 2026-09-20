import "server-only";
import { ActionHistory } from "@/components/activity/action-history";
import { Badge, PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { History } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function ActionHistoryPage() {
  const t = await getTranslations("observe.actionHistory");
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(500);
  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<History />}
        badge={<Badge variant="muted">{t("count", { count: rows.length })}</Badge>}
      />
      <ActionHistory
        rows={rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt.getTime(),
          action: r.action,
          target: r.target,
          status: r.status,
          message: r.message,
          accountId: r.accountId,
        }))}
      />
    </PageShell>
  );
}
