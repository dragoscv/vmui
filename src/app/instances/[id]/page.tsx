import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Apple, MonitorSmartphone, Server, Globe, Cpu, Network, Calendar, DollarSign } from "lucide-react";
import { getInstanceById } from "@/server/queries";
import { getInstancePrice } from "@/lib/pricing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/instances/status-badge";
import { InstanceActions } from "@/components/instances/instance-actions";
import { TerminationLockButton } from "@/components/instances/termination-lock-button";
import { AutoStartToggle } from "@/components/instances/auto-start-toggle";
import { ShowAsCodeDialog } from "@/components/instances/show-as-code-dialog";
import { InstanceStatsPanel } from "@/components/instances/instance-stats-panel";
import { MetricsTab } from "@/components/instances/metrics-tab";
import { ConsoleLogsCard } from "@/components/instances/console-logs-card";
import { CockpitDashboard } from "@/components/instances/cockpit-dashboard";
import { CloudInitStream } from "@/components/instances/cloud-init-stream";
import { ContainerPanel } from "@/components/containers/container-panel";
import { VmHardwareConfig } from "@/components/instances/vm-hardware-config";
import { VmScreenshot } from "@/components/instances/vm-screenshot";
import { InstanceSnapshotsCard } from "@/components/instances/instance-snapshots-card";
import { RelatedResourcesCard } from "@/components/instances/related-resources-card";
import { InstanceSchedulesCard } from "@/components/schedules/instance-schedules-card";
import { StickyNotesCard } from "@/components/instances/sticky-notes";
import { RunbookEditor } from "@/components/instances/runbook-editor";
import { SecretsVault } from "@/components/instances/secrets-vault";
import { ConsoleLinkButton } from "@/components/instances/console-link-button";
import { listSchedulesForInstance } from "@/server/queries/schedules";
import { formatRelative, formatUsd, HOURS_PER_MONTH } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InstanceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const instance = await getInstanceById(decodeURIComponent(id));
  if (!instance) notFound();

  const price = await getInstancePrice(
    instance.provider,
    instance.region,
    instance.instanceType,
    instance.platform,
    instance.accountId,
  );

  const schedules = await listSchedulesForInstance(instance.id);

  const Icon = instance.platform === "macos" ? Apple : instance.platform === "windows" ? MonitorSmartphone : Server;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
      </Button>

      <div
        className="flex flex-wrap items-start justify-between gap-4"
        style={{ viewTransitionName: `inst-${instance.id.replace(/[^a-zA-Z0-9_-]/g, "-")}` }}
      >
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-[var(--shadow-glow)]">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{instance.name ?? instance.providerInstanceId}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted">
              <span className="font-mono text-xs">{instance.providerInstanceId}</span>
              <span>·</span>
              <span>{instance.region}</span>
              <span>·</span>
              <StatusBadge state={instance.state} />
            </div>
          </div>
        </div>
        <InstanceActions instance={instance} />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <ConsoleLinkButton
          providerId={instance.provider as import("@/lib/providers/types").ProviderId}
          region={instance.region}
          providerInstanceId={instance.providerInstanceId}
        />
        <ShowAsCodeDialog
          instance={{
            provider: instance.provider as "aws" | "azure" | "gcp" | "scaleway" | "digitalocean" | "hetzner" | "local-kvm",
            region: instance.region,
            providerInstanceId: instance.providerInstanceId,
            name: instance.name,
            instanceType: instance.instanceType,
            platform: instance.platform as "linux" | "windows" | "macos",
          }}
        />
        <TerminationLockButton
          accountId={instance.accountId}
          region={instance.region}
          providerInstanceId={instance.providerInstanceId}
          initial={instance.terminationLocked ?? false}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Detail icon={Cpu} label="Instance type" value={instance.instanceType ?? "—"} />
        <Detail icon={Server} label="Platform" value={instance.platform} />
        <Detail icon={Network} label="Public IP" value={instance.publicIp ?? "—"} mono />
        <Detail icon={Globe} label="Public DNS" value={instance.publicDns ?? "—"} mono />
        <Detail icon={Network} label="Private IP" value={instance.privateIp ?? "—"} mono />
        <Detail
          icon={Calendar}
          label="Last synced"
          value={instance.lastSyncedAt ? formatRelative(instance.lastSyncedAt) : "—"}
        />
        {price && (
          <Detail
            icon={DollarSign}
            label="On-demand price"
            value={
              price.usdPerHour === 0
                ? "free"
                : `${formatUsd(price.usdPerHour)}/hr · ${formatUsd(price.usdPerHour * HOURS_PER_MONTH)}/mo`
            }
          />
        )}
      </div>

      {instance.provider === "local-kvm" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Live preview</CardTitle>
          </CardHeader>
          <CardContent>
            <VmScreenshot
              accountId={instance.accountId}
              enabled={instance.state === "running"}
              maxWidth={960}
              intervalMs={5000}
            />
          </CardContent>
        </Card>
      )}

      {instance.provider === "local-kvm" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Local KVM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AutoStartToggle accountId={instance.accountId} />
            <Button asChild variant="secondary" size="sm">
              <Link href={`/instances/${encodeURIComponent(instance.id)}/console`}>
                Open in-browser console
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {(instance.provider === "local-kvm" || instance.provider === "aws") && instance.state === "running" && (
        <InstanceStatsPanel accountId={instance.accountId} providerInstanceId={instance.providerInstanceId} instanceId={instance.id} />
      )}

      {instance.state === "running" && (instance.platform === "linux" || instance.platform === "macos") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Live cockpit</CardTitle>
          </CardHeader>
          <CardContent>
            <CockpitDashboard
              instanceId={instance.id}
              intervalSec={instance.probeIntervalSec ?? undefined}
            />
          </CardContent>
        </Card>
      )}

      {(instance.platform === "linux" || instance.platform === "macos") && (
        <CloudInitStream instanceId={instance.id} platform={instance.platform} />
      )}

      {instance.state === "running" && (instance.platform === "linux" || instance.platform === "macos") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Containers</CardTitle>
          </CardHeader>
          <CardContent>
            <ContainerPanel instanceId={instance.id} />
          </CardContent>
        </Card>
      )}

      {(instance.provider === "aws" || instance.provider === "azure" || instance.provider === "gcp") && (
        <MetricsTab
          accountId={instance.accountId}
          providerInstanceId={instance.providerInstanceId}
          enabled={instance.state === "running"}
        />
      )}

      {(instance.provider === "aws" || instance.provider === "azure" || instance.provider === "gcp") && (
        <ConsoleLogsCard
          accountId={instance.accountId}
          providerInstanceId={instance.providerInstanceId}
        />
      )}

      {(instance.provider === "aws" || instance.provider === "azure" || instance.provider === "gcp") && (
        <div id="snapshots" className="scroll-mt-4">
          <InstanceSnapshotsCard
            accountId={instance.accountId}
            region={instance.region}
            providerInstanceId={instance.providerInstanceId}
            provider={instance.provider}
          />
        </div>
      )}

      {(instance.provider === "aws" || instance.provider === "azure" || instance.provider === "gcp") && (
        <RelatedResourcesCard
          accountId={instance.accountId}
          region={instance.region}
          providerInstanceId={instance.providerInstanceId}
        />
      )}

      {instance.provider === "local-kvm" && (
        <VmHardwareConfig
          accountId={instance.accountId}
          vmRunning={instance.state === "running"}
        />
      )}

      {instance.rawJson && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Raw provider data</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-md bg-[var(--color-bg-muted)] p-3 text-xs leading-relaxed">
              {JSON.stringify(JSON.parse(instance.rawJson), null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <InstanceSchedulesCard
        instanceId={instance.id}
        schedules={schedules.map((s) => ({
          id: s.id,
          cron: s.cron,
          action: s.action,
          enabled: s.enabled,
          label: s.label,
          lastRunAt: s.lastRunAt,
          lastRunStatus: s.lastRunStatus,
        }))}
      />

      <StickyNotesCard
        accountId={instance.accountId}
        providerInstanceId={instance.providerInstanceId}
      />

      <RunbookEditor
        accountId={instance.accountId}
        providerInstanceId={instance.providerInstanceId}
      />

      <SecretsVault
        accountId={instance.accountId}
        providerInstanceId={instance.providerInstanceId}
      />
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] text-muted">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
          <div className={mono ? "truncate font-mono text-sm" : "truncate text-sm"}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
