import { BuildsWorkspace } from "@/components/builds/builds-workspace";
import { Button, PageHeader, PageShell } from "@/components/ui";
import { listInstances } from "@/server/queries";
import { Boxes, Hammer } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BuildsPage() {
  const [all, t] = await Promise.all([listInstances(), getTranslations("ops.builds")]);
  const reachable = all
    .filter(
      (i) =>
        i.state === "running" &&
        (i.platform === "linux" || i.platform === "macos") &&
        (i.publicIp || i.publicDns),
    )
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
        icon={<Hammer />}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/containers">
              <Boxes className="size-4" aria-hidden /> {t("viewContainers")}
            </Link>
          </Button>
        }
      />
      <BuildsWorkspace instances={reachable} />
    </PageShell>
  );
}
