import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Apple, MonitorSmartphone, Server, Globe, Cpu, Network, Calendar } from "lucide-react";
import { getInstanceById } from "@/server/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/instances/status-badge";
import { InstanceActions } from "@/components/instances/instance-actions";
import { AutoStartToggle } from "@/components/instances/auto-start-toggle";
import { InstanceStatsPanel } from "@/components/instances/instance-stats-panel";
import { VmHardwareConfig } from "@/components/instances/vm-hardware-config";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InstanceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const instance = await getInstanceById(decodeURIComponent(id));
  if (!instance) notFound();

  const Icon = instance.platform === "macos" ? Apple : instance.platform === "windows" ? MonitorSmartphone : Server;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
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
      </div>

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

      {instance.provider === "local-kvm" && instance.state === "running" && (
        <InstanceStatsPanel accountId={instance.accountId} />
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
