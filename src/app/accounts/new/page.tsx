import { ProviderPicker } from "@/components/accounts/provider-picker";
import { PageHeader, PageShell } from "@/components/ui";
import { KeyRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function NewAccountPage() {
  const t = await getTranslations("cloud.accountNew");
  return (
    <PageShell width="narrow">
      <PageHeader
        icon={<KeyRound />}
        title={t("title")}
        description={t("description")}
        breadcrumbs={
          <nav aria-label={t("breadcrumb")} className="flex items-center gap-1">
            <Link href="/accounts" className="hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {t("back")}
            </Link>
            <span aria-hidden>/</span>
            <span aria-current="page" className="text-fg">
              {t("title")}
            </span>
          </nav>
        }
      />
      <ProviderPicker />
    </PageShell>
  );
}
