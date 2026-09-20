import { ErrorHeatmap, RecentErrorsTable } from "@/components/cloud/error-heatmap";
import { PageHeader, PageSection, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { desc, eq, gte } from "drizzle-orm";
import { AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import "server-only";

export const dynamic = "force-dynamic";

export default async function HeatmapPage() {
  const days = 84; // 12 weeks
  const since = new Date(Date.now() - days * 86_400_000);
  const [t, rows, recentErrors] = await Promise.all([
    getTranslations("cloud.heatmap"),
    db.select().from(auditLog).where(gte(auditLog.createdAt, since)),
    db.select().from(auditLog).where(eq(auditLog.status, "error")).orderBy(desc(auditLog.createdAt)).limit(10),
  ]);

  const errByDay = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "error") continue;
    const k = r.createdAt.toISOString().slice(0, 10);
    errByDay.set(k, (errByDay.get(k) ?? 0) + 1);
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cells: { day: Date; key: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const k = d.toISOString().slice(0, 10);
    cells.push({ day: d, key: k, count: errByDay.get(k) ?? 0 });
  }

  // Group by week (cols of 7 rows). Find offset to start on Sunday column.
  const weeks: typeof cells[] = [];
  let buffer: typeof cells = [];
  for (const c of cells) {
    buffer.push(c);
    if (c.day.getDay() === 6) { weeks.push(buffer); buffer = []; }
  }
  if (buffer.length > 0) weeks.push(buffer);

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description", { days })} icon={<AlertTriangle />} />

      <ErrorHeatmap weeks={weeks.map((w) => w.map((c) => ({ key: c.key, count: c.count })))} />

      <PageSection title={t("recent.title")} description={t("recent.description")}>
        <RecentErrorsTable
          rows={recentErrors.map((r) => ({
            id: r.id,
            createdAt: r.createdAt.toISOString(),
            action: r.action,
            target: r.target,
            message: r.message,
          }))}
        />
      </PageSection>
    </PageShell>
  );
}
