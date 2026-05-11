import { Suspense } from "react";
import { listSnapshotEvents } from "@/server/queries/snapshots";
import { listLocalBackupsAction } from "@/server/actions/local-backup";
import { listInstances } from "@/server/queries";
import { SnapshotCalendar } from "@/components/backups/snapshot-calendar";
import { LocalBackupCard } from "@/components/backups/local-backup-card";
import { BackupsWorkspace } from "@/components/backups/backups-workspace";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, Layers, CalendarDays } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const [events, files, all] = await Promise.all([
    listSnapshotEvents(),
    listLocalBackupsAction(),
    listInstances(),
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

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Backups & Disaster Recovery</h1>
        <p className="text-sm text-muted">
          Snapshots across all your cloud accounts plus local AES-256-GCM archives. Replicate, restore, verify.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Layers className="h-6 w-6 text-[var(--color-primary)]" />
            <div>
              <div className="text-2xl font-semibold">{events.length}</div>
              <div className="text-xs text-muted">total snapshots across {accounts} account{accounts === 1 ? "" : "s"}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <CalendarDays className="h-6 w-6 text-[var(--color-primary)]" />
            <div>
              <div className="text-2xl font-semibold">{last7d}</div>
              <div className="text-xs text-muted">captured in the last 7 days</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <ShieldCheck className="h-6 w-6 text-[var(--color-primary)]" />
            <div>
              <div className="text-2xl font-semibold">{(totalBytes / 1024 / 1024 / 1024).toFixed(1)} GB</div>
              <div className="text-xs text-muted">approximate total snapshot size</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Suspense>
        <SnapshotCalendar events={events} />
      </Suspense>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Scheduled policies</h2>
        <p className="text-xs text-muted">
          Cron-driven cloud snapshots, S3 dumps, local copies, or cross-region snapshots with retention windows.
        </p>
        <BackupsWorkspace instances={reachable} />
      </section>

      <LocalBackupCard initialBackups={files} />
    </div>
  );
}
