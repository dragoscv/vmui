import { CastPlayer } from "@/components/monitoring/cast-player";
import { Badge, Button, PageHeader, PageShell } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { terminalRecordings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ArrowLeft, Download, TerminalSquare } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PlayRecording({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("viewer");
  const { id } = await params;
  const t = await getTranslations("observe.recordings");
  const format = await getFormatter();
  const row = await db.select().from(terminalRecordings).where(eq(terminalRecordings.id, id)).get();
  if (!row) notFound();

  const castUrl = `/api/recordings/${id}`;
  const seconds = format.number(row.durationMs / 1000, { maximumFractionDigits: 1 });
  const kb = format.number(row.sizeBytes / 1024, { maximumFractionDigits: 1 });

  return (
    <PageShell width="narrow">
      <PageHeader
        title={t("player.title")}
        description={row.instanceLabel ?? row.sessionId}
        icon={<TerminalSquare />}
        badge={
          <Badge variant="muted">
            {row.cols}×{row.rows} · {seconds}s · {kb} KB
          </Badge>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/recordings">
                <ArrowLeft className="size-4" aria-hidden /> {t("player.back")}
              </Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <a href={castUrl} download>
                <Download className="size-4" aria-hidden /> {t("download")}
              </a>
            </Button>
          </>
        }
      />
      <CastPlayer src={castUrl} durationMs={row.durationMs} />
      <p className="text-xs text-fg-muted">
        {t.rich("player.tip", { code: (chunks) => <code className="rounded-[var(--radius-sm)] bg-bg-muted px-1 font-mono">{chunks}</code> })}
      </p>
    </PageShell>
  );
}
