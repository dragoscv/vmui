import "server-only";
import { SchedulesManager } from "@/components/schedules/schedules-manager";
import { PageHeader, PageSection, PageShell, Stat, StatGrid } from "@/components/ui";
import { db } from "@/lib/db";
import { cloudAccounts, instances } from "@/lib/db/schema";
import { listSchedules } from "@/server/queries/schedules";
import { CalendarClock, Clock, PauseCircle, PlayCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const [rows, instanceList, accountList, t] = await Promise.all([
    listSchedules(),
    db.select().from(instances),
    db.select().from(cloudAccounts),
    getTranslations("ops.schedules"),
  ]);
  const instanceMap = new Map(instanceList.map((i) => [i.id, i] as const));
  const accountMap = new Map(accountList.map((a) => [a.id, a] as const));

  const summaries = rows.map((s) => {
    const inst = instanceMap.get(s.instanceId);
    const acc = accountMap.get(s.accountId);
    return {
      id: s.id,
      cron: s.cron,
      action: s.action,
      enabled: s.enabled,
      label: s.label,
      lastRunAt: s.lastRunAt,
      lastRunStatus: s.lastRunStatus,
      instanceName: inst?.displayName ?? inst?.name ?? inst?.providerInstanceId ?? t("unknown"),
      accountName: acc?.name ?? t("unknown"),
    };
  });

  const pickList = instanceList
    .map((i) => {
      const acc = accountMap.get(i.accountId);
      return {
        id: i.id,
        label: `${i.displayName ?? i.name ?? i.providerInstanceId} · ${acc?.name ?? i.provider}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const enabled = summaries.filter((s) => s.enabled).length;

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Clock />} />
      <StatGrid cols={3}>
        <Stat label={t("stats.total")} value={summaries.length} icon={<CalendarClock />} />
        <Stat label={t("stats.enabled")} value={enabled} icon={<PlayCircle />} tone={enabled > 0 ? "success" : "default"} />
        <Stat label={t("stats.paused")} value={summaries.length - enabled} icon={<PauseCircle />} />
      </StatGrid>
      <PageSection title={t("listTitle")} description={t("listDescription")}>
        <SchedulesManager initialSchedules={summaries} instances={pickList} />
      </PageSection>
    </PageShell>
  );
}
