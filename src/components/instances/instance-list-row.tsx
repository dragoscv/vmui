"use client";

import { useState } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { Apple, MonitorSmartphone, Server, Pin, StickyNote } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { InstanceActions } from "./instance-actions";
import { RenameInstanceDialog } from "./rename-dialog";
import { NotesDialog } from "./notes-dialog";
import { ConnectDialog } from "./connect-dialog";
import { InstanceStatsDialog } from "./instance-stats-dialog";
import { InstanceContextMenuWrapper } from "./instance-context-wrapper";
import { InstanceMenuButton } from "./instance-menu-button";
import { useInstanceMenuItems } from "./instance-menu";
import { instanceLabel } from "./instance-label";
import { CostPill } from "./cost-pill";
import type { InstanceRow } from "@/lib/db/schema";
import type { PricedRow } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const platformIcon = (p: string) => {
  if (p === "macos") return Apple;
  if (p === "windows") return MonitorSmartphone;
  return Server;
};

export function InstanceListRow({
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
  const [renameOpen, setRenameOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const showStats = instance.provider === "local-kvm" && instance.state === "running";
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
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: Math.min(index, 18) * 0.015, ease: [0.16, 1, 0.3, 1] }}
        onClick={handleClick}
      >
        <InstanceContextMenuWrapper items={menuItems}>
            <div
              className={cn(
                "group flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 transition-[border-color,background-color,box-shadow] sm:py-2.5",
                "hover:border-[color-mix(in_oklch,var(--color-primary)_45%,var(--color-border))]",
                selected &&
                  "border-[color-mix(in_oklch,var(--color-primary)_55%,var(--color-border))] shadow-[var(--shadow-glow)]",
              )}
            >
            <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)]">
              <Icon className="h-4 w-4" />
              {instance.pinned && (
                <span
                  className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                  title="Pinned"
                >
                  <Pin className="h-2 w-2" />
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
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    setRenameOpen(true);
                  }}
                  className="truncate text-sm font-medium hover:underline"
                  title={label}
                >
                  {label}
                </Link>
                {instance.notes && (
                  <StickyNote
                    className="h-3 w-3 shrink-0 text-[var(--color-warning)]"
                    aria-label="Has notes"
                  />
                )}
              </div>
              <div className="truncate text-[11px] text-muted">
                {instance.provider} · {instance.region} ·{" "}
                {instance.instanceType ?? "—"}
                {instance.publicIp && (
                  <>
                    {" · "}
                    <span className="font-mono">{instance.publicIp}</span>
                  </>
                )}
              </div>
            </div>
            <div className="shrink-0">
              <StatusBadge state={instance.state} />
            </div>
            {price && (
              <div className="hidden lg:block">
                <CostPill
                  usdPerHour={price.usdPerHour}
                  source={price.source}
                  showMonthly={false}
                />
              </div>
            )}
            <div className="flex shrink-0 items-center gap-1">
              <div className="hidden lg:flex">
                <InstanceActions instance={instance} />
              </div>
              <InstanceMenuButton items={menuItems} />
            </div>
          </div>
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
