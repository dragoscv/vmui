import { SpendHeatmapGrid } from "@/components/cloud/spend-heatmap-grid";
import { PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { snapshotHistory } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import { Grid3x3 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import "server-only";

export const dynamic = "force-dynamic";

export default async function SpendHeatmapPage() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [t, snaps] = await Promise.all([
    getTranslations("cloud.spendHeatmap"),
    db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, since)),
  ]);

  const cells = new Map<string, { sum: number; n: number }>();
  for (const s of snaps) {
    const dow = s.capturedAt.getUTCDay();
    const hour = s.capturedAt.getUTCHours();
    const k = `${dow}:${hour}`;
    const cur = cells.get(k) ?? { sum: 0, n: 0 };
    cur.sum += s.hourlyUsd; cur.n += 1;
    cells.set(k, cur);
  }
  let max = 0;
  for (const v of cells.values()) max = Math.max(max, v.n > 0 ? v.sum / v.n : 0);

  const serialised = [...cells.entries()].map(([k, v]) => {
    const [dow, hour] = k.split(":").map(Number);
    return { dow: dow ?? 0, hour: hour ?? 0, mean: v.n > 0 ? v.sum / v.n : 0, n: v.n };
  });

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Grid3x3 />} />
      <SpendHeatmapGrid cells={serialised} max={max} />
    </PageShell>
  );
}
