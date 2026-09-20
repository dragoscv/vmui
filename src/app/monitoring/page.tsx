import { MonitoringWorkspace, type FleetSample, type InstanceLite } from "@/components/monitoring/monitoring-workspace";
import { PageHeader, PageShell, Stat, StatGrid } from "@/components/ui";
import { db } from "@/lib/db";
import { probeSamples } from "@/lib/db/schema";
import { listInstances } from "@/server/queries";
import { asc, gte } from "drizzle-orm";
import { Activity, Cpu, MemoryStick, Server } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

const WINDOW_MS = 6 * 60 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;

interface Metrics {
  cpu?: number;
  mem?: number;
  net_in?: number;
  net_out?: number;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export default async function MonitoringPage() {
  const t = await getTranslations("observe.monitoring");
  const all = await listInstances();

  const rows = await db
    .select()
    .from(probeSamples)
    .where(gte(probeSamples.collectedAt, new Date(Date.now() - WINDOW_MS)))
    .orderBy(asc(probeSamples.collectedAt));

  const buckets = new Map<number, { cpu: number[]; mem: number[]; netIn: number[]; netOut: number[] }>();
  const latest = new Map<string, { cpu: number | null; mem: number | null }>();
  for (const r of rows) {
    let m: Metrics;
    try {
      m = JSON.parse(r.metricsJson) as Metrics;
    } catch {
      continue;
    }
    const key = Math.floor(r.collectedAt.getTime() / BUCKET_MS) * BUCKET_MS;
    const b = buckets.get(key) ?? { cpu: [], mem: [], netIn: [], netOut: [] };
    if (typeof m.cpu === "number") b.cpu.push(m.cpu);
    if (typeof m.mem === "number") b.mem.push(m.mem);
    if (typeof m.net_in === "number") b.netIn.push(m.net_in);
    if (typeof m.net_out === "number") b.netOut.push(m.net_out);
    buckets.set(key, b);
    latest.set(r.instanceId, { cpu: m.cpu ?? null, mem: m.mem ?? null });
  }

  const samples: FleetSample[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t0, b]) => ({
      t: t0,
      cpu: avg(b.cpu),
      mem: avg(b.mem),
      netIn: b.netIn.length === 0 ? null : b.netIn.reduce((a, c) => a + c, 0),
      netOut: b.netOut.length === 0 ? null : b.netOut.reduce((a, c) => a + c, 0),
    }));

  const reachable: InstanceLite[] = all
    .filter((i) => i.state === "running" && i.platform !== "windows")
    .map((i) => ({
      id: i.id,
      name: i.name,
      providerInstanceId: i.providerInstanceId,
      provider: i.provider,
      publicIp: i.publicIp,
      publicDns: i.publicDns,
      state: i.state,
      platform: i.platform,
      lastCpu: latest.get(i.id)?.cpu ?? null,
      lastMem: latest.get(i.id)?.mem ?? null,
    }));

  const lastSample = samples.at(-1);
  const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v)}%`);

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Activity />} />
      <StatGrid cols={4}>
        <Stat label={t("stats.monitored")} value={reachable.length} icon={<Server />} />
        <Stat label={t("stats.samples")} value={rows.length} hint={t("stats.window")} icon={<Activity />} />
        <Stat label={t("stats.cpuNow")} value={fmtPct(lastSample?.cpu)} icon={<Cpu />} tone={(lastSample?.cpu ?? 0) > 85 ? "danger" : "default"} />
        <Stat label={t("stats.memNow")} value={fmtPct(lastSample?.mem)} icon={<MemoryStick />} tone={(lastSample?.mem ?? 0) > 85 ? "warning" : "default"} />
      </StatGrid>
      <MonitoringWorkspace instances={reachable} samples={samples} grafanaUrl={process.env.VMUI_GRAFANA_URL ?? ""} />
    </PageShell>
  );
}
