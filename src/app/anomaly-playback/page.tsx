import "server-only";
import { AnomalyPlayback, type PlaybackSample } from "@/components/monitoring/anomaly-playback";
import { EmptyState, PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { instances, probeSamples } from "@/lib/db/schema";
import { and, asc, eq, gte } from "drizzle-orm";
import { Activity, Server } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function AnomalyPlaybackPage(props: { searchParams?: Promise<{ instance?: string; window?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const t = await getTranslations("observe.playback");
  const all = await db.select().from(instances);
  const selected = sp.instance ? all.find((i) => i.id === sp.instance) : all[0];
  const windowHours = Number(sp.window ?? "1") || 1;

  const samples: PlaybackSample[] = [];
  if (selected) {
    const since = new Date(Date.now() - windowHours * 3600_000);
    const rows = await db
      .select()
      .from(probeSamples)
      .where(and(eq(probeSamples.instanceId, selected.id), gte(probeSamples.collectedAt, since)))
      .orderBy(asc(probeSamples.collectedAt));
    for (const r of rows) {
      try {
        const m = JSON.parse(r.metricsJson) as { cpu?: number; mem?: number };
        samples.push({ t: r.collectedAt.getTime(), cpu: m.cpu ?? null, mem: m.mem ?? null });
      } catch {
        /* skip malformed sample */
      }
    }
  }

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Activity />} />
      {all.length === 0 || !selected ? (
        <EmptyState icon={<Server />} title={t("noInstances.title")} description={t("noInstances.description")} />
      ) : (
        <AnomalyPlayback
          samples={samples}
          instances={all.map((i) => ({ id: i.id, label: `${i.name ?? i.providerInstanceId} (${i.region})` }))}
          selected={selected.id}
          windowHours={windowHours}
        />
      )}
    </PageShell>
  );
}
