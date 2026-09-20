import { SecretsWorkspace } from "@/components/secrets/secrets-workspace";
import { PageHeader, PageShell } from "@/components/ui";
import { listInstances } from "@/server/queries";
import { Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function SecretsPage() {
  const [all, t] = await Promise.all([listInstances(), getTranslations("govern.secrets")]);
  const reachable = all
    .filter((i) => i.state === "running" && (i.publicIp || i.publicDns))
    .map((i) => ({
      id: i.id,
      name: i.name,
      providerInstanceId: i.providerInstanceId,
      provider: i.provider,
    }));

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Lock />} />
      <SecretsWorkspace instances={reachable} />
    </PageShell>
  );
}
