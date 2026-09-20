import { ProviderStatusGrid } from "@/components/cloud/provider-status-grid";
import { Alert, EmptyState, PageHeader, PageShell } from "@/components/ui";
import { getProviderStatuses } from "@/lib/provider-status";
import { Activity } from "lucide-react";
import { getTranslations } from "next-intl/server";
import "server-only";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function ProviderStatusPage() {
  const t = await getTranslations("cloud.providerStatus");
  const statuses = await getProviderStatuses();
  return (
    <PageShell>
      <PageHeader icon={<Activity />} title={t("title")} description={t("description")} />
      {statuses.length === 0 ? (
        <EmptyState icon={<Activity />} title={t("state.unknown")} />
      ) : (
        <ProviderStatusGrid
          statuses={statuses.map((s) => ({ id: s.id, label: s.label, url: s.url, state: s.state, latencyMs: s.latencyMs }))}
        />
      )}
      <Alert tone="info">{t("note")}</Alert>
    </PageShell>
  );
}
