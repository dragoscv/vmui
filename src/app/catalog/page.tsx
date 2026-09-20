import { CatalogCard } from "@/components/catalog/catalog-card";
import { PageHeader, PageShell } from "@/components/ui";
import { CATALOG } from "@/lib/catalog";
import { Boxes } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-static";

export default async function CatalogPage() {
  const t = await getTranslations("ops.catalog");
  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Boxes />} />
      <section aria-label={t("title")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
        {CATALOG.map((tpl, i) => (
          <CatalogCard key={tpl.id} template={tpl} index={i} />
        ))}
      </section>
    </PageShell>
  );
}
