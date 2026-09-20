import "server-only";
import { TrashTable } from "@/components/cloud/trash-table";
import { Badge, EmptyState, PageHeader, PageShell, SkeletonTable } from "@/components/ui";
import { db } from "@/lib/db";
import { instanceTrash } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function TrashPage() {
  const t = await getTranslations("cloud.trash");
  const rows = await db.select().from(instanceTrash).orderBy(desc(instanceTrash.terminatedAt)).limit(500);

  return (
    <PageShell>
      <PageHeader
        icon={<Trash2 />}
        title={t("title")}
        description={t("description")}
        badge={<Badge variant="muted">{t("count", { count: rows.length })}</Badge>}
      />

      {rows.length === 0 ? (
        <EmptyState icon={<Trash2 />} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <Suspense fallback={<SkeletonTable rows={6} cols={5} />}>
          <TrashTable
            rows={rows.map((r) => ({
              id: r.id,
              name: r.name,
              providerInstanceId: r.providerInstanceId,
              provider: r.provider,
              region: r.region,
              instanceType: r.instanceType,
              terminatedAt: r.terminatedAt.toISOString(),
            }))}
          />
        </Suspense>
      )}
    </PageShell>
  );
}
