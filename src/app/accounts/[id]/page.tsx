import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound, Server, Boxes, Activity, TrendingUp, DollarSign } from "lucide-react";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { cloudAccounts, instances, cachedResources, auditLog } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { listAccountHistory } from "@/server/queries/history";
import { priceInstances } from "@/lib/pricing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import { StatusBadge } from "@/components/instances/status-badge";
import { AccountRegionsEditor } from "@/components/accounts/account-regions-editor";
import { AccountDefaultTagsEditor } from "@/components/accounts/account-default-tags-editor";
import { AccountBudgetEditor } from "@/components/accounts/account-budget-editor";
import { SnapshotRetentionEditor } from "@/components/accounts/snapshot-retention-editor";
import { RequiredTagsEditor } from "@/components/accounts/required-tags-editor";
import { VcpuQuotaEditor } from "@/components/accounts/vcpu-quota-editor";
import { SafeTerminateEditor } from "@/components/accounts/safe-terminate-editor";
import { DeleteAccountButton } from "@/components/accounts/delete-account-button";
import { formatRelative, formatUsd, HOURS_PER_MONTH } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AccountDetailPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  const accountRows = await db.select().from(cloudAccounts).where(eq(cloudAccounts.id, id)).limit(1);
  const account = accountRows[0];
  if (!account) notFound();
  const meta = account.metadataEnc
    ? decryptJSON<{ accountId: string; label: string }>(account.metadataEnc)
    : null;
  const regions = account.regions ? safeArr(account.regions) : null;

  const [instanceRows, resourceRows, auditRows, history] = await Promise.all([
    db.select().from(instances).where(eq(instances.accountId, id)).orderBy(desc(instances.lastSyncedAt)),
    db.select().from(cachedResources).where(eq(cachedResources.accountId, id)),
    db.select().from(auditLog).where(eq(auditLog.accountId, id)).orderBy(desc(auditLog.createdAt)).limit(20),
    listAccountHistory(id),
  ]);

  const priceMap = await priceInstances(
    instanceRows.map((i) => ({
      id: i.id,
      provider: i.provider,
      region: i.region,
      instanceType: i.instanceType,
      platform: i.platform,
      accountId: i.accountId,
    })),
  );
  const running = instanceRows.filter((i) => i.state === "running");
  const hourly = running.reduce((s, i) => s + (priceMap[i.id]?.usdPerHour ?? 0), 0);

  const byRegion = new Map<string, { running: number; total: number; hourly: number }>();
  for (const i of instanceRows) {
    const slot = byRegion.get(i.region) ?? { running: 0, total: 0, hourly: 0 };
    slot.total++;
    if (i.state === "running") {
      slot.running++;
      slot.hourly += priceMap[i.id]?.usdPerHour ?? 0;
    }
    byRegion.set(i.region, slot);
  }

  const ordered = history.slice().reverse();
  const runSeries = ordered.map((r) => r.runningInstances);
  const hourlySeries = ordered.map((r) => r.hourlyUsd);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/accounts">
          <ArrowLeft className="h-4 w-4" /> All accounts
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-[var(--shadow-glow)]">
            <KeyRound className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{account.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge variant="info">{account.provider.toUpperCase()}</Badge>
              <span className="font-mono text-xs">{meta?.label ?? meta?.accountId ?? id}</span>
              <span>·</span>
              <span>connected {formatRelative(account.createdAt)}</span>
            </div>
          </div>
        </div>
        <DeleteAccountButton id={account.id} name={account.name} />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat icon={Server} label="Instances" value={String(instanceRows.length)} />
        <Stat icon={Activity} label="Running" value={String(running.length)} accent="success" />
        <Stat icon={Boxes} label="Resources" value={String(resourceRows.length)} />
        <Stat
          icon={DollarSign}
          label="Burn / mo"
          value={hourly > 0 ? formatUsd(hourly * HOURS_PER_MONTH) : "—"}
        />
      </div>

      {runSeries.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4" /> 7-day trend
            </CardTitle>
            <CardDescription>Running instances and hourly burn captured at every sync.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">Running</div>
              <Sparkline values={runSeries} className="text-[var(--color-success)]" width={400} height={60} />
            </div>
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">$ / hr</div>
              <Sparkline values={hourlySeries} className="text-[var(--color-primary)]" width={400} height={60} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Regions</CardTitle>
          <CardDescription>Synced regions for this account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AccountRegionsEditor
            accountId={account.id}
            provider={account.provider}
            defaultRegion={account.defaultRegion}
            initialRegions={regions}
          />
          {byRegion.size > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from(byRegion.entries()).map(([region, s]) => (
                <div
                  key={region}
                  className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2 text-xs"
                >
                  <span className="font-mono">{region}</span>
                  <span className="text-muted">
                    {s.running}/{s.total} running · {s.hourly > 0 ? formatUsd(s.hourly * HOURS_PER_MONTH) + "/mo" : "free"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Default tags</CardTitle>
          <CardDescription>Auto-applied to instances created via vmui for this account.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountDefaultTagsEditor accountId={account.id} initial={account.defaultTags ?? null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Snapshot retention</CardTitle>
          <CardDescription>Keep only the most recent N snapshots per instance; delete the rest.</CardDescription>
        </CardHeader>
        <CardContent>
          <SnapshotRetentionEditor accountId={account.id} initial={account.snapshotRetentionCount ?? null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Monthly budget cap</CardTitle>
          <CardDescription>Hard limit. New instances are refused when projected burn would exceed this.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountBudgetEditor accountId={account.id} initial={account.monthlyBudgetUsd ?? null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Required tags</CardTitle>
          <CardDescription>Compliance scan flags instances missing any of these keys.</CardDescription>
        </CardHeader>
        <CardContent>
          <RequiredTagsEditor accountId={account.id} initial={account.requiredTags ?? null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">vCPU quota</CardTitle>
          <CardDescription>Hard cap on the sum of vCPUs across running instances in this account.</CardDescription>
        </CardHeader>
        <CardContent>
          <VcpuQuotaEditor accountId={account.id} initial={account.vcpuQuota ?? null} />
        </CardContent>
      </Card>

      <SafeTerminateEditor accountId={account.id} initial={account.safeTerminate ?? false} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Instances</CardTitle>
        </CardHeader>
        <CardContent>
          {instanceRows.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted">No instances synced yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {instanceRows.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2.5">
                  <Link
                    href={`/instances/${encodeURIComponent(i.id)}`}
                    className="flex flex-1 items-center gap-3 hover:underline"
                  >
                    <StatusBadge state={i.state} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{i.displayName ?? i.name ?? i.providerInstanceId}</div>
                      <div className="text-xs text-muted">
                        {i.region} · {i.instanceType ?? "—"}
                      </div>
                    </div>
                  </Link>
                  <div className="text-right text-xs text-muted">
                    {(() => {
                      const u = priceMap[i.id]?.usdPerHour;
                      return typeof u === "number" ? formatUsd(u) + "/hr" : "—";
                    })()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {auditRows.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted">No recorded activity yet.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {auditRows.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <Badge variant={r.status === "ok" ? "success" : "danger"}>{r.status}</Badge>
                  <span className="font-mono">{r.action}</span>
                  {r.target && <span className="text-muted">· {r.target}</span>}
                  <span className="ml-auto text-muted">{formatRelative(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: "success";
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] text-muted">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
          <div
            className={
              accent === "success"
                ? "truncate text-lg font-semibold tabular-nums text-[var(--color-success)]"
                : "truncate text-lg font-semibold tabular-nums"
            }
          >
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function safeArr(raw: string): string[] | null {
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.every((s) => typeof s === "string")) return v;
  } catch {
    // ignore
  }
  return null;
}
