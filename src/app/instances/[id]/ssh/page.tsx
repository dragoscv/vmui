import { SshClient } from "@/components/instances/ssh-client";
import { Button, PageHeader, PageShell } from "@/components/ui";
import { getInstanceById } from "@/server/queries";
import { listSshKeys } from "@/server/queries/ssh-keys";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InstanceSshPage({ params }: PageProps) {
  const { id } = await params;
  const instance = await getInstanceById(decodeURIComponent(id));
  if (!instance) notFound();
  const [keys, t] = await Promise.all([listSshKeys(), getTranslations("vm.ssh")]);
  const savedKeys = keys.map((k) => ({
    id: k.id,
    name: k.name,
    algo: k.algo,
    hasPrivate: k.hasPrivateKey,
  }));
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
      <SshClient instance={instance} savedKeys={savedKeys} />
    </PageShell>
  );
}
