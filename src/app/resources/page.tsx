import { Suspense } from "react";
import Link from "next/link";
import { GitCommitVertical } from "lucide-react";
import { listAllResources } from "@/server/queries/resources";
import { ResourcesExplorer } from "@/components/resources/resources-explorer";
import { SyncResourcesButton } from "@/components/resources/sync-resources-button";
import { ExportButtons } from "@/components/ui/export-buttons";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const rows = await listAllResources();
  const byKind = rows.reduce<Record<string, typeof rows>>((acc, r) => {
    (acc[r.kind] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resources</h1>
          <p className="text-sm text-muted">
            Volumes, snapshots, security groups, keypairs and networks across every connected account.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            filename={`vmui-resources-${new Date().toISOString().slice(0, 10)}`}
            rows={rows.map((r) => ({
              id: r.id,
              provider: r.provider,
              region: r.region,
              kind: r.kind,
              externalId: r.externalId,
              name: r.name,
              status: r.status,
              sizeBytes: r.sizeBytes,
              attachedToInstanceId: r.attachedToInstanceId,
              monthlyUsd: r.monthlyUsd,
            }))}
          />
          <Suspense>
            <SyncResourcesButton />
          </Suspense>
          <Link
            href="/resources/drift"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-white/5"
          >
            <GitCommitVertical className="h-3.5 w-3.5" /> Drift history
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] p-10 text-center text-sm text-muted">
          No resources cached yet. Click <em>Sync resources</em> to pull volumes, snapshots, security groups and
          networks from all your AWS accounts.
        </div>
      ) : (
        <ResourcesExplorer byKind={byKind} />
      )}
    </div>
  );
}
