import "server-only";
import { BurnRateChart } from "@/components/cloud/burn-rate-chart";
import { BurnRateThresholdForm } from "@/components/cloud/burn-rate-threshold-form";
import { Alert, PageHeader, PageSection, PageShell, Stat, StatGrid } from "@/components/ui";
import { computeBurnRate, getBurnRateThreshold, setBurnRateThreshold } from "@/lib/burn-rate";
import { requireRole } from "@/lib/auth";
import { formatUsd } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { snapshotHistory } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import { Flame } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

async function saveThreshold(formData: FormData) {
  "use server";
  await requireRole("admin");
  await setBurnRateThreshold(Number(formData.get("threshold") ?? 0));
  revalidatePath("/burn-rate");
}

export default async function BurnRatePage() {
  const [t, report, threshold] = await Promise.all([getTranslations("cloud.burnRate"), computeBurnRate(), getBurnRateThreshold()]);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const snaps = await db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, since));
  // Aggregate per-day max hourly per account, then sum across accounts.
  const byDay = new Map<string, Map<string, number>>(); // day -> account -> hourly
  for (const s of snaps) {
    const day = s.capturedAt.toISOString().slice(0, 10);
    let m = byDay.get(day);
    if (!m) { m = new Map(); byDay.set(day, m); }
    const cur = m.get(s.accountId) ?? 0;
    if (s.hourlyUsd > cur) m.set(s.accountId, s.hourlyUsd);
  }
  const days = Array.from(byDay.entries())
    .map(([day, m]) => ({ day, daily: Array.from(m.values()).reduce((a, b) => a + b, 0) * 24 }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Flame />} />

      {report.exceeded && (
        <Alert tone="danger" title={t("exceeded.title")}>
          {t("exceeded.description", { daily: formatUsd(report.projectedDailyUsd), threshold: formatUsd(threshold) })}
        </Alert>
      )}

      <StatGrid cols={3}>
        <Stat label={t("stats.projectedDaily")} value={formatUsd(report.projectedDailyUsd)} tone={report.exceeded ? "danger" : "default"} />
        <Stat label={t("stats.projectedMonthly")} value={formatUsd(report.projectedMonthlyUsd)} />
        <Stat label={t("stats.threshold")} value={threshold > 0 ? formatUsd(threshold) : "—"} tone={report.exceeded ? "danger" : "default"} />
      </StatGrid>

      <PageSection title={t("threshold.title")} description={t("threshold.description")}>
        <BurnRateThresholdForm threshold={threshold} action={saveThreshold} />
      </PageSection>

      <BurnRateChart days={days} threshold={threshold} />
    </PageShell>
  );
}
