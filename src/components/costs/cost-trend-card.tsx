import "server-only";
import { PageSection } from "@/components/ui";
import { Sparkline } from "@/components/ui/sparkline";
import { db } from "@/lib/db";
import { snapshotHistory } from "@/lib/db/schema";
import { cn, formatUsdPerHour } from "@/lib/utils";
import { gte } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

/**
 * 7-day hourly-burn trend from snapshot_history, aggregated into one-hour
 * buckets so multi-account captures at different cadences stay readable.
 */
export async function CostTrendCard({ days = 7 }: { days?: number } = {}) {
  const t = await getTranslations("cloud.costs.trend");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, since));

  if (rows.length < 2) {
    return (
      <PageSection title={t("title", { days })} description={t("description")}>
        <p className="text-xs text-muted">{t("notEnough")}</p>
      </PageSection>
    );
  }

  const bucketSize = 60 * 60 * 1000;
  const buckets = new Map<number, number>();
  for (const r of rows) {
    const ts = Math.floor(r.capturedAt.getTime() / bucketSize) * bucketSize;
    buckets.set(ts, (buckets.get(ts) ?? 0) + r.hourlyUsd);
  }
  const values = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);

  const last = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const delta = last - first;
  const pct = first > 0 ? (delta / first) * 100 : 0;
  const deltaTone = delta > 0.01 ? "text-warning" : delta < -0.01 ? "text-success" : "text-muted";

  return (
    <PageSection
      title={t("title", { days })}
      description={t("description")}
      action={
        <span className={cn("text-xs font-medium tabular-nums", deltaTone)}>
          {t("delta", {
            delta: `${delta >= 0 ? "+" : ""}${formatUsdPerHour(delta)}`,
            pct: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}`,
            days,
          })}
        </span>
      }
    >
      <div className="text-primary">
        <Sparkline values={values} width={800} height={112} className="h-28 w-full" ariaLabel={t("chartLabel", { days })} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>{t("startLabel", { days })}</span>
        <span className="tabular-nums">
          {t("currentLabel")} · {formatUsdPerHour(last)}
        </span>
      </div>
    </PageSection>
  );
}
