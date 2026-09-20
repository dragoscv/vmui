import "server-only";
import { ResourceCleanupTable } from "@/components/resources/resource-cleanup-table";
import { Alert, EmptyState, PageHeader, PageShell, SkeletonTable } from "@/components/ui";
import { formatUsd } from "@/lib/utils";
import { listAllResources } from "@/server/queries/resources";
import { Trash2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function ResourceCleanupPage() {
  const t = await getTranslations("cloud.cleanup");
  const all = await listAllResources();
  // AWS-only candidates: unattached volumes, all snapshots, keypairs.
  const candidates = all.filter(
    (r) =>
      r.provider === "aws" &&
      ((r.kind === "volume" && !r.attachedToInstanceId) || r.kind === "snapshot" || r.kind === "keypair"),
  );
  const savings = candidates.reduce((s, r) => s + (r.monthlyUsd ?? 0), 0);

  return (
    <PageShell>
      <PageHeader
        icon={<Trash2 />}
        title={t("title")}
        description={t("description")}
        breadcrumbs={
          <Link href="/resources" className="hover:text-fg hover:underline">
            {t("breadcrumb")}
          </Link>
        }
      />

      {candidates.length === 0 ? (
        <EmptyState icon={<Trash2 />} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <>
          <Alert tone="warning">{t("summary", { count: candidates.length, savings: formatUsd(savings) })}</Alert>
          <Suspense fallback={<SkeletonTable rows={6} cols={6} />}>
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
          </Suspense>
        </>
      )}
    </PageShell>
  );
}
