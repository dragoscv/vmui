import { RecordingsTable, type RecordingItem } from "@/components/monitoring/recordings-table";
import { Badge, PageHeader, PageSection, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { terminalRecordings } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { TerminalSquare } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function RecordingsPage() {
  const t = await getTranslations("observe.recordings");
  const rows = await db.select().from(terminalRecordings).orderBy(desc(terminalRecordings.startedAt)).limit(200);
  const items: RecordingItem[] = rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.getTime(),
    instanceLabel: r.instanceLabel,
    sizeBytes: r.sizeBytes,
    durationMs: r.durationMs,
    cols: r.cols,
    rows: r.rows,
  }));

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t.rich("description", { code: (chunks) => <code className="rounded-[var(--radius-sm)] bg-bg-muted px-1 font-mono text-xs">{chunks}</code> })}
        icon={<TerminalSquare />}
        badge={<Badge variant="muted">{t("count", { count: items.length })}</Badge>}
      />
      <PageSection title={t("listTitle")}>
        <RecordingsTable rows={items} />
      </PageSection>
    </PageShell>
  );
}
