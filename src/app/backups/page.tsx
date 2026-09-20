import { BackupsWorkspace } from "@/components/backups/backups-workspace";
import { LocalBackupCard } from "@/components/backups/local-backup-card";
import { SnapshotCalendar } from "@/components/backups/snapshot-calendar";
import { SnapshotTable } from "@/components/backups/snapshot-table";
import { Button, PageHeader, PageSection, PageShell, SkeletonCard, Stat, StatGrid } from "@/components/ui";
import { listLocalBackupsAction } from "@/server/actions/local-backup";
import { listInstances } from "@/server/queries";
import { listSnapshotEvents } from "@/server/queries/snapshots";
import { CalendarDays, DatabaseBackup, Layers, RotateCcw, ShieldCheck } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const [events, files, all, t, format] = await Promise.all([
    listSnapshotEvents(),
    listLocalBackupsAction(),
    listInstances(),
    getTranslations("ops.backups"),
    getFormatter(),
  ]);
  const reachable = all.map((i) => ({
    id: i.id,
    name: i.name,
    providerInstanceId: i.providerInstanceId,
    provider: i.provider,
  }));

  const totalBytes = events.reduce((a, e) => a + (e.sizeBytes ?? 0), 0);
  const accounts = new Set(events.map((e) => e.accountId)).size;
  const last7d = events.filter((e) => Date.now() - e.capturedAt < 7 * 24 * 60 * 60 * 1000).length;
  const totalGb = format.number(totalBytes / 1024 / 1024 / 1024, { maximumFractionDigits: 1 });

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<DatabaseBackup />}
        actions={
          <Button asChild variant="secondary">
            <Link href="/restore">
              <RotateCcw className="size-4" aria-hidden /> {t("restore")}
            </Link>
          </Button>
        }
      />

      <StatGrid cols={3}>
        <Stat label={t("stats.total")} value={events.length} hint={t("stats.totalHint", { accounts })} icon={<Layers />} />
        <Stat label={t("stats.last7d")} value={last7d} hint={t("stats.last7dHint")} icon={<CalendarDays />} />
        <Stat label={t("stats.size")} value={t("stats.sizeValue", { gb: totalGb })} hint={t("stats.sizeHint")} icon={<ShieldCheck />} />
      </StatGrid>

      <Suspense fallback={<SkeletonCard />}>
        <SnapshotCalendar events={events} />
      </Suspense>

      <PageSection title={t("snapshots.title")} description={t("snapshots.description")}>
        <SnapshotTable events={events} />
      </PageSection>

      <PageSection title={t("policies.title")} description={t("policies.description")}>
        <BackupsWorkspace instances={reachable} />
      </PageSection>

      <LocalBackupCard initialBackups={files} />
    </PageShell>
  );
}
