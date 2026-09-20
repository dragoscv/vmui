import { DigestView, type DigestErrorItem } from "@/components/activity/digest-view";
import { Alert, PageHeader, PageShell, Stat, StatGrid } from "@/components/ui";
import { db } from "@/lib/db";
import { auditLog, instances } from "@/lib/db/schema";
import { desc, gte } from "drizzle-orm";
import { Activity, AlertTriangle, CheckCircle2, Server, Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function DigestPage({ searchParams }: { searchParams: Promise<{ hours?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations("observe.digest");
  const hours = Math.max(1, Math.min(168, Number(sp.hours ?? 1) || 1));
  const since = new Date(Date.now() - hours * 3600_000);
  const [events, fleet] = await Promise.all([
    db.select().from(auditLog).where(gte(auditLog.createdAt, since)).orderBy(desc(auditLog.createdAt)).limit(500),
    db.select().from(instances),
  ]);

  const byAction = new Map<string, number>();
  let errors = 0;
  for (const e of events) {
    byAction.set(e.action, (byAction.get(e.action) ?? 0) + 1);
    if (e.status === "error") errors++;
  }
  const top = [...byAction.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([action, count]) => ({ action, count }));
  const running = fleet.filter((i) => i.state === "running").length;
  const recentErrors: DigestErrorItem[] = events
    .filter((e) => e.status === "error")
    .slice(0, 20)
    .map((e) => ({ id: e.id, action: e.action, target: e.target, message: e.message, createdAt: e.createdAt.getTime() }));

  return (
    <PageShell width="narrow">
      <PageHeader title={t("title")} description={t("description")} icon={<Sparkles />} />
      <Alert tone={errors === 0 ? "success" : "warning"} title={errors === 0 ? t("headlineClean", { count: events.length, hours }) : t("headlineErrors", { count: events.length, hours, errors })} />
      <StatGrid cols={3}>
        <Stat label={t("stats.events")} value={events.length} icon={<Activity />} />
        <Stat label={t("stats.errors")} value={errors} tone={errors > 0 ? "danger" : "success"} icon={errors > 0 ? <AlertTriangle /> : <CheckCircle2 />} />
        <Stat label={t("stats.fleetRunning")} value={`${running} / ${fleet.length}`} icon={<Server />} />
      </StatGrid>
      <DigestView hours={hours} top={top} errors={recentErrors} />
    </PageShell>
  );
}
