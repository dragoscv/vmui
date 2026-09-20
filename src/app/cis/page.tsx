import { CisWorkspace, type CisResultRow } from "@/components/compliance/cis-workspace";
import { PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { cisCheckResults, cloudAccounts, instances } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import "server-only";

export const dynamic = "force-dynamic";

export default async function CisPage(props: { searchParams?: Promise<{ instance?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const [linuxInst, accs, t] = await Promise.all([
    db.select().from(instances).where(eq(instances.platform, "linux")),
    db.select({ id: cloudAccounts.id, name: cloudAccounts.name }).from(cloudAccounts),
    getTranslations("govern.cis"),
  ]);
  const accNames = new Map(accs.map((a) => [a.id, a.name]));
  const selected = sp.instance ? linuxInst.find((i) => i.id === sp.instance) : null;

  const results = selected
    ? await db.select().from(cisCheckResults)
        .where(eq(cisCheckResults.providerInstanceId, selected.providerInstanceId))
        .orderBy(desc(cisCheckResults.ranAt)).limit(100)
    : [];

  const groupedLatest = new Map<string, CisResultRow>();
  for (const r of results) if (!groupedLatest.has(r.checkId)) groupedLatest.set(r.checkId, r);

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<ShieldCheck />} />
      <CisWorkspace
        instances={linuxInst.map((i) => ({
          id: i.id,
          accountId: i.accountId,
          providerInstanceId: i.providerInstanceId,
          label: `${i.name ?? i.providerInstanceId} · ${accNames.get(i.accountId) ?? i.accountId}`,
        }))}
        selectedId={selected?.id ?? null}
        results={[...groupedLatest.values()].map((r) => ({ id: r.id, checkId: r.checkId, title: r.title, result: r.result, evidence: r.evidence, ranAt: r.ranAt }))}
      />
    </PageShell>
  );
}
