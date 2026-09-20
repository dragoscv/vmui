import { DriftTable } from "@/components/resources/drift-table";
import { Alert, EmptyState, PageHeader, PageShell, SkeletonTable } from "@/components/ui";
import { db } from "@/lib/db";
import { cloudAccounts, resourceHistory } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { GitCommitVertical } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Suspense } from "react";
import "server-only";

export const dynamic = "force-dynamic";

function tryPretty(s: string | null): string {
  if (!s) return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function diffLines(a: string | null, b: string): { added: number; removed: number } {
  const pa = new Set(tryPretty(a).split("\n"));
  const pb = new Set(tryPretty(b).split("\n"));
  let added = 0;
  let removed = 0;
  for (const l of pb) if (!pa.has(l)) added++;
  for (const l of pa) if (!pb.has(l)) removed++;
  return { added, removed };
}

export default async function DriftPage() {
  const t = await getTranslations("cloud.drift");
  const [rows, accounts] = await Promise.all([
    db.select().from(resourceHistory).orderBy(desc(resourceHistory.capturedAt)).limit(150),
    db.select().from(cloudAccounts),
  ]);
  const acctMap = new Map(accounts.map((a) => [a.id, a]));
  const entries = rows.map((r) => {
    const d = diffLines(r.prevJson, r.nextJson);
    return {
      id: r.id,
      kind: r.kind,
      externalId: r.externalId,
      region: r.region,
      accountName: acctMap.get(r.accountId)?.name ?? null,
      added: d.added,
      removed: d.removed,
      capturedAt: r.capturedAt.toISOString(),
    };
  });
  const totalAdded = entries.reduce((s, e) => s + e.added, 0);
  const totalRemoved = entries.reduce((s, e) => s + e.removed, 0);

  return (
    <PageShell>
      <PageHeader
        icon={<GitCommitVertical />}
        title={t("title")}
        description={t("description")}
        breadcrumbs={
          <Link href="/resources" className="hover:text-fg hover:underline">
            {t("breadcrumb")}
          </Link>
        }
      />

      {entries.length === 0 ? (
        <EmptyState icon={<GitCommitVertical />} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <>
          <Alert tone="info" title={t("totals", { count: entries.length, added: totalAdded, removed: totalRemoved })}>
            {t("about")}
          </Alert>
          <Suspense fallback={<SkeletonTable rows={8} cols={6} />}>
            <DriftTable rows={entries} />
          </Suspense>
        </>
      )}
    </PageShell>
  );
}
