import { VncConsoleClient } from "@/components/instances/vnc-console-client";
import { Alert, Button, PageHeader, PageShell } from "@/components/ui";
import { getInstanceById } from "@/server/queries";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InstanceConsolePage({ params }: PageProps) {
  const { id } = await params;
  const instance = await getInstanceById(decodeURIComponent(id));
  if (!instance) notFound();
  const t = await getTranslations("vm.console");
  const name = instance.name ?? instance.providerInstanceId;
  const detailHref = `/instances/${encodeURIComponent(instance.id)}`;

  return (
    <PageShell width="full">
      <PageHeader
        title={t("title")}
        description={t("description", { name })}
        breadcrumbs={
          <nav aria-label={t("breadcrumb")} className="flex items-center gap-1">
            <Link href="/" className="hover:text-fg">{t("breadcrumb")}</Link>
            <span aria-hidden>/</span>
            <Link href={detailHref} className="truncate hover:text-fg">{name}</Link>
          </nav>
        }
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={detailHref}>
              <ArrowLeft className="size-4" aria-hidden /> {t("back")}
            </Link>
          </Button>
        }
      />
      {instance.provider !== "local-kvm" ? (
        <Alert tone="info">{t.rich("localOnly", { b: (c) => <b className="font-medium text-fg">{c}</b> })}</Alert>
      ) : (
        <VncConsoleClient
          accountId={instance.accountId}
          region={instance.region}
          providerInstanceId={instance.providerInstanceId}
          instanceName={name}
        />
      )}
    </PageShell>
  );
}
