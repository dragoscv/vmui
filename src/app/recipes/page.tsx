import { RecipesGrid } from "@/components/recipes/recipes-grid";
import { PageHeader, PageShell } from "@/components/ui";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const t = await getTranslations("ops.recipes");
  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Sparkles />} />
      <RecipesGrid />
    </PageShell>
  );
}
