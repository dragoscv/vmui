import "server-only";
import { db } from "@/lib/db";
import { instances, probeSamples } from "@/lib/db/schema";
import { and, asc, eq, gte } from "drizzle-orm";
import { AnomalyPlaybackClient } from "@/components/anomaly-playback.client";

export const dynamic = "force-dynamic";

export default async function AnomalyPlaybackPage(props: { searchParams?: Promise<{ instance?: string; window?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const all = await db.select().from(instances);
  const selected = sp.instance ? all.find((i) => i.id === sp.instance) : all[0];
  const windowHours = Number(sp.window ?? "1") || 1;

  let samples: { t: number; cpu?: number; mem?: number }[] = [];
  if (selected) {
    const since = new Date(Date.now() - windowHours * 3600_000);
    const rows = await db.select().from(probeSamples)
      .where(and(eq(probeSamples.instanceId, selected.id), gte(probeSamples.collectedAt, since)))
      .orderBy(asc(probeSamples.collectedAt));
    for (const r of rows) {
      try {
        const m = JSON.parse(r.metricsJson) as { cpu?: number; mem?: number };
        samples.push({ t: r.collectedAt.getTime(), cpu: m.cpu, mem: m.mem });
      } catch { /* skip */ }
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Anomaly playback</h1>
        <p className="text-sm text-zinc-400">Animate a CPU/memory window. Use this to spot the moment of an incident.</p>
      </header>

      <form method="GET" className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
        <select name="instance" defaultValue={selected?.id ?? ""} className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1">
          {all.map((i) => <option key={i.id} value={i.id}>{i.name ?? i.providerInstanceId} ({i.region})</option>)}
        </select>
        <select name="window" defaultValue={String(windowHours)} className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1">
          <option value="1">1h</option><option value="6">6h</option><option value="24">24h</option><option value="72">72h</option>
        </select>
        <button type="submit" className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1">Load</button>
        <span className="text-zinc-500">{samples.length} samples</span>
      </form>

      {samples.length === 0
        ? <div className="text-sm text-zinc-500">No samples in this window. Make sure live stats probe is running.</div>
        : <AnomalyPlaybackClient samples={samples} />}
    </div>
  );
}
