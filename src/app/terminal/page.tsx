import { TerminalPicker } from "@/components/terminal/terminal-picker";
import { Badge, Button, PageHeader, PageShell } from "@/components/ui";
import { listInstances } from "@/server/queries";
import { Boxes, TerminalSquare } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TerminalPage() {
  const [all, t] = await Promise.all([listInstances(), getTranslations("ops.terminal")]);
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
      publicIp: i.publicIp,
    }));

  return (
    <PageShell width="full">
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<TerminalSquare />}
        badge={<Badge variant="muted">{t("hostCount", { count: reachable.length })}</Badge>}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/containers">
              <Boxes className="size-4" aria-hidden /> {t("viewContainers")}
            </Link>
          </Button>
        }
      />
      <div className="h-[calc(100dvh-12rem)] min-h-[24rem]">
        <TerminalPicker instances={reachable} />
      </div>
    </PageShell>
  );
}
