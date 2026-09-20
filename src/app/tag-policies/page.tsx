import "server-only";
import { TagPoliciesWorkspace } from "@/components/tags/tag-policies-workspace";
import { PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { tagPolicies } from "@/lib/db/schema";
import { evaluateTagPolicies } from "@/lib/tag-policy";
import { desc } from "drizzle-orm";
import { Tag } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

function parseKeys(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export default async function TagPoliciesPage() {
  const [policies, violations, t] = await Promise.all([
    db.select().from(tagPolicies).orderBy(desc(tagPolicies.createdAt)),
    evaluateTagPolicies(),
    getTranslations("govern.tagPolicies"),
  ]);

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Tag />} />
      <TagPoliciesWorkspace
        policies={policies.map((p) => ({ id: p.id, name: p.name, condition: p.condition, requireKeys: parseKeys(p.requireKeysJson), enabled: Boolean(p.enabled) }))}
        violations={violations}
      />
    </PageShell>
  );
}
