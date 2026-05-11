import Link from "next/link";
import { Cloud, Server, ArrowRight, Sparkles } from "lucide-react";
import { listAccounts, listInstancesWithPrices } from "@/server/queries";
import { InstancesExplorer } from "@/components/instances/instances-explorer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { BackgroundSync } from "@/components/instances/background-sync";
import { RunningVmsStrip } from "@/components/instances/running-vms-strip";
import { CostAnomalyBanner } from "@/components/dashboard/cost-anomaly-banner";
import { AccountSpendCards } from "@/components/dashboard/account-spend-cards";
import { HeroCanvas } from "@/components/dashboard/hero-canvas";
import { formatUsd, HOURS_PER_MONTH } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [accounts, { instances, priceMap }] = await Promise.all([
    listAccounts(),
    listInstancesWithPrices(),
  ]);

  if (accounts.length === 0) {
    return <EmptyState />;
  }

  const running = instances.filter((i) => i.state === "running").length;
  const stopped = instances.filter((i) => i.state === "stopped").length;
  const providers = Array.from(new Set(instances.map((i) => i.provider))).sort();
  const runningInstances = instances.filter((i) => i.state === "running");

  // Burn estimate: sum hourly cost of running instances × 730
  const monthlyBurn = runningInstances.reduce((sum, i) => {
    const p = priceMap[i.id]?.usdPerHour ?? 0;
    return sum + p * HOURS_PER_MONTH;
  }, 0);
  const knownPriceCount = runningInstances.filter(
    (i) => priceMap[i.id]?.usdPerHour != null,
  ).length;

  return (
    <div className="space-y-6">
      <BackgroundSync enabled={accounts.length > 0} />
      <CostAnomalyBanner />

      {/* Hero */}
      <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-gradient-to-br from-[color-mix(in_oklch,var(--color-primary)_18%,var(--color-surface))] to-[var(--color-surface)] p-6 sm:p-8">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-[color-mix(in_oklch,var(--color-accent)_30%,transparent)] blur-3xl" />
        <HeroCanvas />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_20%,transparent)] px-3 py-1 text-xs font-medium text-[var(--color-primary)]">
              <Sparkles className="h-3 w-3" /> live
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Your fleet at a glance
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              {accounts.length} account{accounts.length === 1 ? "" : "s"} connected · auto-syncing every 15s in the background.
            </p>
          </div>
          <div className="flex flex-wrap gap-6">
            <Stat label="Total" value={instances.length} />
            <Stat label="Running" value={running} accent="success" />
            <Stat label="Stopped" value={stopped} accent="muted" />
            <Stat
              label={`Burn / mo${knownPriceCount < runningInstances.length ? " · est" : ""}`}
              value={formatUsd(monthlyBurn)}
            />
          </div>
        </div>
      </section>

      {/* Running fleet — live previews */}
      {runningInstances.length > 0 && (
        <RunningVmsStrip instances={runningInstances} priceMap={priceMap} />
      )}

      {/* Spend by account */}
      <AccountSpendCards accounts={accounts} instances={instances} priceMap={priceMap} />

      {/* Instances */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Instances</h2>
          <Button asChild variant="secondary" size="sm">
            <Link href="/instances/new">
              <Server className="h-4 w-4" /> Launch new
            </Link>
          </Button>
        </div>
        {instances.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-muted">
                No instances yet. Launch one to get started — vmui will auto-sync from your accounts.
              </p>
              <div className="mt-4">
                <Button asChild>
                  <Link href="/instances/new">
                    Launch instance <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <InstancesExplorer instances={instances} providers={providers} priceMap={priceMap} />
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "success" | "muted";
}) {
  return (
    <div className="text-right">
      <div
        className={
          accent === "success"
            ? "text-3xl font-semibold tabular-nums text-[var(--color-success)]"
            : accent === "muted"
              ? "text-3xl font-semibold tabular-nums text-muted"
              : "text-3xl font-semibold tabular-nums"
        }
      >
        {value}
      </div>
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto mt-12 max-w-2xl">
      <Card>
        <CardHeader>
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-[var(--shadow-glow)]">
            <Cloud className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Welcome to vmui</CardTitle>
          <CardDescription>
            Connect a cloud account to start managing virtual machines from one beautiful place.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm text-muted">
            <li>· One-click start / stop / reboot on any instance</li>
            <li>· Smart connect: .rdp file for Windows, SSH + VNC for macOS, SSH for Linux</li>
            <li>· Background status checks every 15 seconds</li>
            <li>· AES-256-GCM encrypted credentials, stored locally</li>
          </ul>
          <ProviderConstellation />
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/accounts/new">
                Connect AWS account <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/accounts">All accounts</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderConstellation() {
  const items = [
    { id: "aws", label: "AWS", glyph: "AWS", color: "#ff9900" },
    { id: "azure", label: "Azure", glyph: "AZ", color: "#0078d4" },
    { id: "gcp", label: "GCP", glyph: "GCP", color: "#4285f4" },
    { id: "scaleway", label: "Scaleway", glyph: "SW", color: "#4f0599" },
    { id: "local-kvm", label: "Local KVM", glyph: "KVM", color: "#16a34a" },
  ] as const;
  return (
    <div className="grid grid-cols-5 gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklch,var(--color-border)_70%,transparent)] bg-[color-mix(in_oklch,var(--color-surface)_50%,transparent)] p-3">
      {items.map((p) => (
        <div
          key={p.id}
          className="group flex flex-col items-center gap-1.5 rounded-[var(--radius-sm)] py-2 transition hover:bg-[color-mix(in_oklch,var(--color-surface-2)_60%,transparent)]"
          title={p.label}
        >
          <span
            className="grid h-9 w-9 place-items-center rounded-full text-[10px] font-bold tracking-tight text-white shadow-sm transition group-hover:scale-110"
            style={{ background: p.color }}
            aria-hidden
          >
            {p.glyph}
          </span>
          <span className="text-[10px] text-muted">{p.label}</span>
        </div>
      ))}
    </div>
  );
}
