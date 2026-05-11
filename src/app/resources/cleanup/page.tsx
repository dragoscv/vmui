import "server-only";
import { Trash2 } from "lucide-react";
import { listAllResources } from "@/server/queries/resources";
import { ResourceCleanupTable } from "@/components/resources/resource-cleanup-table";

export const dynamic = "force-dynamic";

export default async function ResourceCleanupPage() {
  const all = await listAllResources();
  // AWS-only candidates: unattached volumes, all snapshots, keypairs.
  const candidates = all.filter(
    (r) =>
      r.provider === "aws" &&
      ((r.kind === "volume" && !r.attachedToInstanceId) || r.kind === "snapshot" || r.kind === "keypair"),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Trash2 className="h-6 w-6 text-[var(--color-primary)]" />
          Resource cleanup
        </h1>
        <p className="text-sm text-muted">
          Permanently delete AWS resources not attached to any instance. Volumes still mounted to a VM are filtered
          out automatically.
        </p>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] p-10 text-center text-sm text-muted">
          No detached resources found in cache. Run a sync first.
        </div>
      ) : (
        <ResourceCleanupTable
          rows={candidates.map((r) => ({
            id: r.id,
            externalId: r.externalId,
            region: r.region,
            kind: r.kind,
            name: r.name,
            sizeBytes: r.sizeBytes,
            status: r.status,
            monthlyUsd: r.monthlyUsd,
          }))}
        />
      )}
    </div>
  );
}
