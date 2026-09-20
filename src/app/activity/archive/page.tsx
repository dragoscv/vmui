import { ArchiveList, type ArchiveFile } from "@/components/activity/archive-list";
import { Badge, PageHeader, PageSection, PageShell } from "@/components/ui";
import { env } from "@/lib/env";
import { Archive } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import "server-only";

export const dynamic = "force-dynamic";

export default async function AuditArchivePage() {
  const t = await getTranslations("observe.archive");
  const dbPath = resolve(process.cwd(), env.VMUI_DB_PATH);
  const archiveDir = resolve(dirname(dbPath), "audit-archive");

  let files: ArchiveFile[] = [];
  if (existsSync(archiveDir)) {
    files = readdirSync(archiveDir)
      .filter((f) => f.endsWith(".json.gz"))
      .map((f) => {
        const s = statSync(join(archiveDir, f));
        return { name: f, size: s.size, mtime: s.mtime.getTime() };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  return (
    <PageShell width="narrow">
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<Archive />}
        badge={<Badge variant="muted">{t("fileCount", { count: files.length })}</Badge>}
      />
      <PageSection title={t("filesTitle")} description={t("inspectHint", { dir: archiveDir })}>
        <ArchiveList files={files} />
      </PageSection>
    </PageShell>
  );
}
