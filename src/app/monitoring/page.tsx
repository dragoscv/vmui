import { listInstances } from "@/server/queries";
import { MonitoringWorkspace } from "@/components/monitoring/monitoring-workspace";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  const all = await listInstances();
  const reachable = all
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
    }));

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Monitoring</h1>
        <p className="text-sm text-muted">
          One-click node_exporter deployment, generated Prometheus scrape config, and an embedded Grafana dashboard.
        </p>
      </header>
      <MonitoringWorkspace instances={reachable} grafanaUrl={process.env.VMUI_GRAFANA_URL ?? ""} />
    </main>
  );
}
