import { ContainersOverview } from "@/components/containers/containers-overview";
import { Button, PageHeader, PageShell } from "@/components/ui";
import { listInstances } from "@/server/queries";
import { Boxes, TerminalSquare } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ContainersPage() {
  const [all, t] = await Promise.all([listInstances(), getTranslations("ops.containers")]);
  const reachable = all.filter(
    (i) =>
      i.state === "running" &&
      (i.platform === "linux" || i.platform === "macos") &&
      (i.publicIp || i.publicDns),
  );
  const hosts = reachable.map((i) => ({
    id: i.id,
    name: i.name,
    providerInstanceId: i.providerInstanceId,
    provider: i.provider,
    region: i.region,
    address: i.publicIp ?? i.publicDns ?? null,
  }));

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<Boxes />}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/terminal">
              <TerminalSquare className="size-4" aria-hidden /> {t("openTerminal")}
            </Link>
          </Button>
        }
      />
      <ContainersOverview hosts={hosts} />
    </PageShell>
  );
}
