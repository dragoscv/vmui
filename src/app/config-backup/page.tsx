import { ConfigBackupFlow } from "@/components/config-backup/config-backup-flow";
import { Button, PageHeader, PageShell } from "@/components/ui";
import { DatabaseBackup, Download } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function ConfigBackupPage() {
  const t = await getTranslations("ops.configBackup");
  return (
    <PageShell width="narrow">
      <PageHeader
        title={t("title")}
        description={t.rich("description", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}
        icon={<DatabaseBackup />}
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href="/api/config/export" download>
              <Download className="size-4" aria-hidden /> {t("steps.export.download")}
            </a>
          </Button>
        }
      />
      <ConfigBackupFlow />
    </PageShell>
  );
}
