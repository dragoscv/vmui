import { BulkTagPanel } from "@/components/tags/bulk-tag-panel";
import { TagGovernancePanel } from "@/components/tags/tag-governance-panel";
import { PageHeader, PageShell } from "@/components/ui";
import { listInstances } from "@/server/queries";
import { getTagGovernance } from "@/server/queries/tag-governance";
import { Tag } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const [instances, governance, t] = await Promise.all([listInstances(), getTagGovernance(), getTranslations("govern.tags")]);
  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Tag />} />
      <TagGovernancePanel data={governance} />
      <BulkTagPanel
        rows={instances.map((i) => ({
          id: i.id,
          name: i.name,
          displayName: i.displayName,
          provider: i.provider,
          region: i.region,
          state: i.state,
          instanceType: i.instanceType,
        }))}
      />
    </PageShell>
  );
}
