"use client";

import { useState } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { Apple, MonitorSmartphone, Server, Globe, Pin, StickyNote, Moon, Cpu } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "./status-badge";
import { InstanceActions } from "./instance-actions";
import { InstanceStatsInline } from "./instance-stats-inline";
import { InstanceStatsDialog } from "./instance-stats-dialog";
import { RenameInstanceDialog } from "./rename-dialog";
import { NotesDialog } from "./notes-dialog";
import { ConnectDialog } from "./connect-dialog";
import { InstanceContextMenuWrapper } from "./instance-context-wrapper";
import { InstanceMenuButton } from "./instance-menu-button";
import { useInstanceMenuItems } from "./instance-menu";
import { instanceLabel } from "./instance-label";
import { VmScreenshot } from "./vm-screenshot";
import { CostPill } from "./cost-pill";
import { Badge } from "@/components/ui/badge";
import { detectIdle } from "@/lib/idle";
import { detectGpu } from "@/lib/gpu-detect";
import type { InstanceRow } from "@/lib/db/schema";
import type { PricedRow } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const platformIcon = (p: string) => {
  if (p === "macos") return Apple;
  if (p === "windows") return MonitorSmartphone;
  return Server;
};

export function InstanceCard({
  instance,
  index = 0,
  selected,
  onToggleSelect,
  selectionActive,
  price,
}: {
  instance: InstanceRow;
  index?: number;
  selected?: boolean;
  onToggleSelect?: (id: string, additive: boolean) => void;
  selectionActive?: boolean;
  price?: PricedRow;
}) {
  const Icon = platformIcon(instance.platform);
  const [statsOpen, setStatsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const showStats =
    (instance.provider === "local-kvm" || instance.provider === "aws") &&
    instance.state === "running";
  const showScreenshot = instance.provider === "local-kvm";
  const label = instanceLabel(instance);

  const menuItems = useInstanceMenuItems(instance, {
    rename: () => setRenameOpen(true),
    notes: () => setNotesOpen(true),
    connect: () => setConnectOpen(true),
    stats: showStats ? () => setStatsOpen(true) : undefined,
  });

  function handleClick(e: React.MouseEvent) {
    if (selectionActive && onToggleSelect) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(instance.id, e.metaKey || e.ctrlKey || e.shiftKey);
    }
  }

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: Math.min(index, 12) * 0.03, ease: [0.16, 1, 0.3, 1] }}
        onClick={handleClick}
      >
        <InstanceContextMenuWrapper items={menuItems}>
          <Card
            className={cn(
              "card-hover cursor-default transition-[border-color,box-shadow]",
              selected &&
                "border-[color-mix(in_oklch,var(--color-primary)_55%,var(--color-border))] shadow-[var(--shadow-glow)]",
            )}
            style={{ viewTransitionName: `inst-${instance.id.replace(/[^a-zA-Z0-9_-]/g, "-")}` }}
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)]">
                    <Icon className="h-4 w-4" />
                    {instance.pinned && (
                      <span
                        className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                        title="Pinned"
                      >
                        <Pin className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/instances/${encodeURIComponent(instance.id)}`}
                        onClick={(e) => {
                          if (selectionActive) e.preventDefault();
                        }}
                        className="block min-w-0 truncate font-semibold hover:underline"
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          setRenameOpen(true);
                        }}
                        title={`${label} — double-click to rename`}
                      >
                        {label}
                      </Link>
                      {instance.notes && (
                        <span title={instance.notes} aria-label="Has notes">
                          <StickyNote className="h-3 w-3 shrink-0 text-[var(--color-warning)]" />
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">
                      {instance.providerInstanceId} · {instance.instanceType ?? "—"}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <StatusBadge state={instance.state} />
                  {(() => {
                    const gpu = detectGpu(instance.instanceType);
                    return gpu ? (
                      <Badge variant="info" title={`${gpu.count}× NVIDIA ${gpu.model}`} className="gap-1">
                        <Cpu className="h-3 w-3" /> {gpu.count}×{gpu.model}
                      </Badge>
                    ) : null;
                  })()}
                  {(() => {
                    const idle = detectIdle({ state: instance.state, lastStateChangeAt: instance.lastStateChangeAt });
                    return idle.isIdle ? (
                      <Badge
                        variant="warning"
                        title={`Running for ${idle.idleDays}d with no state change \u2014 possibly idle`}
                        className="gap-1"
                      >
                        <Moon className="h-3 w-3" /> idle {idle.idleDays}d
                      </Badge>
                    ) : null;
                  })()}
                  <InstanceMenuButton items={menuItems} />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {showScreenshot && (
                <div className="mb-3">
                  <VmScreenshot
                    accountId={instance.accountId}
                    enabled={instance.state === "running"}
                    maxWidth={400}
                  />
                </div>
              )}
              {showStats && (
                <div className="mb-3">
                  <InstanceStatsInline
                    accountId={instance.accountId}
                    enabled={showStats}
                    providerInstanceId={instance.providerInstanceId}
                    instanceId={instance.id}
                    onOpenDetails={() => setStatsOpen(true)}
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{instance.region}</span>
                  {instance.publicIp && (
                    <>
                      <span className="opacity-40">·</span>
                      <span className="truncate font-mono text-[11px]">{instance.publicIp}</span>
                    </>
                  )}
                </div>
                <InstanceActions instance={instance} />
              </div>
              {price && (
                <div className="mt-2 border-t border-[var(--color-border)] pt-2">
                  <CostPill usdPerHour={price.usdPerHour} source={price.source} />
                </div>
              )}
            </CardContent>
          </Card>
        </InstanceContextMenuWrapper>
      </motion.div>
      <RenameInstanceDialog open={renameOpen} onOpenChange={setRenameOpen} instance={instance} />
      <NotesDialog open={notesOpen} onOpenChange={setNotesOpen} instance={instance} />
      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} instance={instance} />
      {showStats && (
        <InstanceStatsDialog open={statsOpen} onOpenChange={setStatsOpen} instance={instance} />
      )}
    </>
  );
}
