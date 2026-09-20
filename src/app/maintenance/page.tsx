import "server-only";
import { MaintenanceCreateForm } from "@/components/maintenance/maintenance-create-form";
import { MaintenanceWindowsTable, type MaintenanceRow } from "@/components/maintenance/maintenance-windows-table";
import { Badge, PageHeader, PageSection, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { cloudAccounts, maintenanceWindows } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { CalendarClock } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const t = await getTranslations("ops.maintenance");
  const [windows, accounts] = await Promise.all([
    db.select().from(maintenanceWindows).orderBy(desc(maintenanceWindows.startsAt)).limit(200),
    db.select({ id: cloudAccounts.id, name: cloudAccounts.name }).from(cloudAccounts),
  ]);
  const now = Date.now();

  const rows: MaintenanceRow[] = windows.map((w) => ({
    id: w.id,
    name: w.name,
    reason: w.reason,
    startsAt: w.startsAt,
    endsAt: w.endsAt,
    mode: w.mode,
    scope: w.accountId ? (accounts.find((a) => a.id === w.accountId)?.name ?? w.accountId) : null,
    status:
      w.startsAt.getTime() <= now && w.endsAt.getTime() >= now
        ? "active"
        : w.startsAt.getTime() > now
          ? "upcoming"
          : "past",
  }));
  const activeCount = rows.filter((r) => r.status === "active").length;

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<CalendarClock />}
        badge={
          activeCount > 0 ? (
            <Badge variant="warning" dot>
              {t("activeBadge", { count: activeCount })}
            </Badge>
          ) : (
            <Badge variant="muted">{t("count", { count: rows.length })}</Badge>
          )
        }
      />

      <PageSection title={t("listTitle")} description={t("listDescription")}>
        <MaintenanceWindowsTable rows={rows} />
      </PageSection>

      <PageSection id="maintenance-form" title={t("formTitle")} description={t("formDescription")}>
        <MaintenanceCreateForm accounts={accounts} />
      </PageSection>
    </PageShell>
  );
}
