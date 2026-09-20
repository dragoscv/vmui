import { AutoTagWorkspace } from "@/components/tags/auto-tag-workspace";
import { PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { autoTagRules } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { Tag } from "lucide-react";
import { getTranslations } from "next-intl/server";
import "server-only";

export const dynamic = "force-dynamic";

export default async function AutoTagPage() {
  const [rules, t] = await Promise.all([db.select().from(autoTagRules).orderBy(desc(autoTagRules.priority)), getTranslations("govern.autoTag")]);
  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Tag />} />
      <AutoTagWorkspace rules={rules.map((r) => ({ id: r.id, namePattern: r.namePattern, tagKey: r.tagKey, tagValue: r.tagValue, priority: r.priority, enabled: r.enabled === 1 }))} />
    </PageShell>
  );
}
