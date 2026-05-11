"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { Apple, MonitorSmartphone, Server, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VmScreenshot } from "./vm-screenshot";
import { instanceLabel } from "./instance-label";
import { InstanceStatsInline } from "./instance-stats-inline";
import { CostPill } from "./cost-pill";
import type { InstanceRow } from "@/lib/db/schema";
import type { PricedRow } from "@/lib/pricing";

const platformIcon = (p: string) => {
  if (p === "macos") return Apple;
  if (p === "windows") return MonitorSmartphone;
  return Server;
};

/**
 * Hero strip on the dashboard showing the running fleet at a glance.
 * Local-KVM VMs get a live screenshot + inline stats; cloud VMs get a
 * tasteful gradient placard with platform icon & connect shortcut.
 */
export function RunningVmsStrip({
  instances,
  priceMap,
}: {
  instances: InstanceRow[];
  priceMap?: Record<string, PricedRow>;
}) {
  if (instances.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Live</h2>
        <span className="text-xs text-muted">
          {instances.length} running
        </span>
      </div>
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
        {instances.map((i, idx) => (
          <motion.div
            key={i.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: Math.min(idx, 8) * 0.05, ease: [0.16, 1, 0.3, 1] }}
            className="snap-start"
          >
            <RunningCard instance={i} price={priceMap?.[i.id]} />
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function RunningCard({ instance, price }: { instance: InstanceRow; price?: PricedRow }) {
  const Icon = platformIcon(instance.platform);
  const isKvm = instance.provider === "local-kvm";
  const label = instanceLabel(instance);
  return (
    <div className="surface group relative w-72 overflow-hidden p-2">
      {isKvm ? (
        <VmScreenshot
          accountId={instance.accountId}
          enabled
          maxWidth={400}
          intervalMs={6000}
          className="aspect-video"
        />
      ) : (
        <div className="relative grid aspect-video place-items-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-gradient-to-br from-[color-mix(in_oklch,var(--color-primary)_25%,var(--color-surface))] to-[color-mix(in_oklch,var(--color-accent)_25%,var(--color-surface))]">
          <div className="absolute -bottom-10 -right-10 h-40 w-40 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_40%,transparent)] blur-3xl transition-transform duration-700 group-hover:scale-110" />
          <Icon className="relative h-10 w-10 text-white/90" />
        </div>
      )}

      <div className="mt-2 flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <Link
            href={`/instances/${encodeURIComponent(instance.id)}`}
            className="block truncate text-sm font-semibold hover:underline"
            title={label}
          >
            {label}
          </Link>
          <div className="truncate text-[11px] text-muted">
            {instance.region} · {instance.instanceType ?? "—"}
          </div>
          {price && (
            <div className="mt-0.5">
              <CostPill usdPerHour={price.usdPerHour} source={price.source} showMonthly={false} />
            </div>
          )}
        </div>
        <Button asChild variant="secondary" size="sm" className="h-7 shrink-0 px-2 text-xs">
          <Link href={`/instances/${encodeURIComponent(instance.id)}`}>
            <Plug className="h-3 w-3" />
          </Link>
        </Button>
      </div>

      {isKvm && (
        <div className="px-1 pt-1">
          <InstanceStatsInline accountId={instance.accountId} enabled providerInstanceId={instance.providerInstanceId} instanceId={instance.id} />
        </div>
      )}
    </div>
  );
}
