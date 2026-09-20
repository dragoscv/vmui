import "server-only";
import { SavedSearches } from "@/components/activity/saved-searches";
import { Badge, PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { savedSearches } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { Bookmark } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function SavedSearchesPage() {
  const t = await getTranslations("observe.savedSearches");
  const rows = await db.select().from(savedSearches).orderBy(desc(savedSearches.pinned), desc(savedSearches.createdAt));

  return (
    <PageShell width="narrow">
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<Bookmark />}
        badge={<Badge variant="muted">{t("count", { count: rows.length })}</Badge>}
      />
      <SavedSearches items={rows.map((s) => ({ id: s.id, name: s.name, query: s.query, pinned: s.pinned }))} />
    </PageShell>
  );
}
