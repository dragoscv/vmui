import "server-only";
import { ComplianceWorkspace } from "@/components/compliance/compliance-workspace";
import { PageHeader, PageShell } from "@/components/ui";
import { scanCompliance } from "@/server/queries/compliance";
import { ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  const [findings, t] = await Promise.all([scanCompliance(), getTranslations("govern.compliance")]);
  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<ShieldAlert />} />
      <ComplianceWorkspace findings={findings} />
    </PageShell>
  );
}
