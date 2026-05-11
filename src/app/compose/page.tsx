import { getComposeRecipeAction, listComposeRecipesAction } from "@/server/actions/compose";
import { listInstances } from "@/server/queries";
import { ComposeWorkspace } from "@/components/compose/compose-workspace";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function ComposePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const recipes = await listComposeRecipesAction();
  const initial = sp.id
    ? await getComposeRecipeAction(sp.id)
    : { recipe: null, versions: [] };
  const allInstances = await listInstances();
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
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Compose recipes</h1>
        <p className="max-w-2xl text-sm text-muted">
          Author and version-control docker-compose YAMLs, then apply them to
          any reachable Linux VM. Each save creates a new version.
        </p>
      </header>
      <ComposeWorkspace recipes={recipes} initial={initial} instances={reachable} />
    </main>
  );
}
