import { ResourcesExplorer } from "@/components/resources/resources-explorer";
import { SyncResourcesButton } from "@/components/resources/sync-resources-button";
import { Badge, Button, EmptyState, PageHeader, PageShell, Skeleton, SkeletonTable } from "@/components/ui";
import { ExportButtons } from "@/components/ui/export-buttons";
import { listAllResources } from "@/server/queries/resources";
import { Boxes, GitCommitVertical, Trash2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const t = await getTranslations("cloud.resources");
  const rows = await listAllResources();

  return (
    <PageShell>
      <PageHeader
        icon={<Boxes />}
        title={t("title")}
        description={t("description")}
        badge={<Badge variant="muted">{t("count", { count: rows.length })}</Badge>}
        actions={
          <>
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
            <Suspense fallback={<Skeleton className="h-9 w-36" />}>
              <SyncResourcesButton />
            </Suspense>
            <Button asChild variant="outline">
              <Link href="/resources/drift">
                <GitCommitVertical className="size-4" aria-hidden /> {t("driftLink")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/resources/cleanup">
                <Trash2 className="size-4" aria-hidden /> {t("cleanupLink")}
              </Link>
            </Button>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState icon={<Boxes />} title={t("empty.title")} description={t("empty.description")} action={<SyncResourcesButton />} />
      ) : (
        <Suspense fallback={<SkeletonTable rows={8} cols={6} />}>
          <ResourcesExplorer rows={rows} />
        </Suspense>
      )}
    </PageShell>
  );
}
