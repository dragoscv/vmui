"use client";

import { useState } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { Apple, MonitorSmartphone, Server, Globe } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "./status-badge";
import { InstanceActions } from "./instance-actions";
import { InstanceStatsInline } from "./instance-stats-inline";
import { InstanceStatsDialog } from "./instance-stats-dialog";
import type { InstanceRow } from "@/lib/db/schema";

const platformIcon = (p: string) => {
  if (p === "macos") return Apple;
  if (p === "windows") return MonitorSmartphone;
  return Server;
};

export function InstanceCard({
  instance,
  index = 0,
}: {
  instance: InstanceRow;
  index?: number;
}) {
  const Icon = platformIcon(instance.platform);
  const [statsOpen, setStatsOpen] = useState(false);
  const showStats = instance.provider === "local-kvm" && instance.state === "running";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)]">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <Link
                  href={`/instances/${encodeURIComponent(instance.id)}`}
                  className="block truncate font-semibold hover:underline"
                >
                  {instance.name ?? instance.providerInstanceId}
                </Link>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {instance.providerInstanceId} · {instance.instanceType ?? "—"}
                </div>
              </div>
            </div>
            <StatusBadge state={instance.state} />
          </div>
        </CardHeader>
        <CardContent>
          {showStats && (
            <div className="mb-3">
              <InstanceStatsInline
                accountId={instance.accountId}
                enabled={showStats}
                onOpenDetails={() => setStatsOpen(true)}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted">
              <Globe className="h-3.5 w-3.5" />
              <span>{instance.region}</span>
              {instance.publicIp && (
                <>
                  <span className="opacity-40">·</span>
                  <span className="font-mono text-[11px]">{instance.publicIp}</span>
                </>
              )}
            </div>
            <InstanceActions instance={instance} />
          </div>
        </CardContent>
      </Card>
      {showStats && (
        <InstanceStatsDialog
          open={statsOpen}
          onOpenChange={setStatsOpen}
          instance={instance}
        />
      )}
    </motion.div>
  );
}
