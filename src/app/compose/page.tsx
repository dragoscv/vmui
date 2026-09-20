import { ComposeWorkspace } from "@/components/compose/compose-workspace";
import { Badge, Button, PageHeader, PageShell } from "@/components/ui";
import { getComposeRecipeAction, listComposeRecipesAction } from "@/server/actions/compose";
import { listInstances } from "@/server/queries";
import { Boxes, FileStack } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function ComposePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const [recipes, initial, allInstances, t] = await Promise.all([
    listComposeRecipesAction(),
    sp.id ? getComposeRecipeAction(sp.id) : Promise.resolve({ recipe: null, versions: [] }),
    listInstances(),
    getTranslations("ops.compose"),
  ]);
  const reachable = allInstances
    .filter((i) => i.state === "running" && i.platform === "linux" && (i.publicIp || i.publicDns))
    .map((i) => ({
      id: i.id,
      name: i.name,
      providerInstanceId: i.providerInstanceId,
      provider: i.provider,
      region: i.region,
    }));

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<FileStack />}
        badge={<Badge variant="muted">{t("stackCount", { count: recipes.length })}</Badge>}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/containers">
              <Boxes className="size-4" aria-hidden /> {t("viewContainers")}
            </Link>
          </Button>
        }
      />
      <ComposeWorkspace recipes={recipes} initial={initial} instances={reachable} />
    </PageShell>
  );
}
