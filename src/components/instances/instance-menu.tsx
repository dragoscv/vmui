"use client";

import * as React from "react";
import {
  Play,
  Square,
  RotateCw,
  Trash2,
  Plug,
  Pin,
  PinOff,
  Pencil,
  StickyNote,
  Copy,
  ExternalLink,
  BarChart3,
  RefreshCw,
  Camera,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  instanceAction,
  setInstancePinnedAction,
  syncAccountInstances,
} from "@/server/actions/instances";
import { checkSnapshotFreshness } from "@/server/actions/snapshot-freshness";
import type { InstanceRow } from "@/lib/db/schema";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { instanceLabel } from "./instance-label";

export type InstanceMenuItemDescriptor =
  | { kind: "item"; key: string; label: string; icon: React.ComponentType<{ className?: string }>; onSelect: () => void; disabled?: boolean; danger?: boolean; shortcut?: string }
  | { kind: "separator"; key: string }
  | { kind: "label"; key: string; label: string };

export function useInstanceMenuItems(
  instance: InstanceRow,
  open: {
    rename: () => void;
    notes: () => void;
    connect: () => void;
    stats?: () => void;
  },
): InstanceMenuItemDescriptor[] {
  const router = useRouter();
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const label = instanceLabel(instance);
  const isRunning = instance.state === "running";
  const isStopped = instance.state === "stopped";
  const showStats =
    instance.provider === "local-kvm" && instance.state === "running" && !!open.stats;

  function run(action: "start" | "stop" | "reboot" | "terminate") {
    start(async () => {
      if (action === "terminate") {
        const freshness = await checkSnapshotFreshness({
          accountId: instance.accountId,
          region: instance.region,
          providerInstanceId: instance.providerInstanceId,
        });
        const warning = !freshness.hasAny
          ? "No snapshot of this instance exists in our cache. If you need its disk later, take a snapshot first."
          : !freshness.hasRecent
            ? `Most recent matching snapshot is ${freshness.daysSince}d old. Consider snapshotting first.`
            : null;
        const ok = await confirm({
          title: `Terminate ${label}?`,
          description: (
            <>
              This permanently destroys the instance. <b>This cannot be undone.</b>
              {warning && (
                <div className="mt-2 rounded-md border border-[var(--color-warning)]/40 bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] p-2 text-xs">
                  ⚠ {warning}
                </div>
              )}
            </>
          ),
          tone: "danger",
          confirmText: "Terminate",
          requireText: "terminate",
        });
        if (!ok) return;
      } else if (action === "stop") {
        const ok = await confirm({
          title: `Stop ${label}?`,
          description: "The VM will shut down. Disk data is preserved.",
          tone: "warning",
          confirmText: "Stop",
        });
        if (!ok) return;
      }
      const r = await instanceAction(action, {
        accountId: instance.accountId,
        region: instance.region,
        providerInstanceId: instance.providerInstanceId,
      });
      if (r.ok) {
        toast.success(`${action} requested`);
        router.refresh();
      } else {
        toast.error(r.error ?? "Failed");
      }
    });
  }

  function togglePin() {
    start(async () => {
      const r = await setInstancePinnedAction({ id: instance.id, pinned: !instance.pinned });
      if (r.ok) {
        toast.success(instance.pinned ? "Unpinned" : "Pinned to top");
        router.refresh();
      }
    });
  }

  function copyId() {
    void navigator.clipboard.writeText(instance.providerInstanceId);
    toast.success("Instance ID copied");
  }

  function copyIp() {
    if (!instance.publicIp) return;
    void navigator.clipboard.writeText(instance.publicIp);
    toast.success("Public IP copied");
  }

  function syncNow() {
    start(async () => {
      try {
        const r = await syncAccountInstances(instance.accountId);
        toast.success(`Synced ${r.count} instance${r.count === 1 ? "" : "s"}`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Sync failed");
      }
    });
  }

  const items: InstanceMenuItemDescriptor[] = [
    {
      kind: "item",
      key: "connect",
      label: "Connect",
      icon: Plug,
      disabled: !isRunning || pending,
      onSelect: open.connect,
    },
  ];

  if (isStopped) {
    items.push({
      kind: "item",
      key: "start",
      label: "Start",
      icon: Play,
      disabled: pending,
      onSelect: () => run("start"),
    });
  }
  if (isRunning) {
    items.push({
      kind: "item",
      key: "stop",
      label: "Stop",
      icon: Square,
      disabled: pending,
      onSelect: () => run("stop"),
    });
    items.push({
      kind: "item",
      key: "reboot",
      label: "Reboot",
      icon: RotateCw,
      disabled: pending,
      onSelect: () => run("reboot"),
    });
  }

  items.push({ kind: "separator", key: "sep1" });

  items.push({
    kind: "item",
    key: "rename",
    label: "Rename…",
    icon: Pencil,
    onSelect: open.rename,
    shortcut: "F2",
  });
  items.push({
    kind: "item",
    key: "pin",
    label: instance.pinned ? "Unpin" : "Pin to top",
    icon: instance.pinned ? PinOff : Pin,
    onSelect: togglePin,
    disabled: pending,
  });
  items.push({
    kind: "item",
    key: "notes",
    label: instance.notes ? "Edit notes…" : "Add notes…",
    icon: StickyNote,
    onSelect: open.notes,
  });

  if (showStats) {
    items.push({
      kind: "item",
      key: "stats",
      label: "Detailed stats…",
      icon: BarChart3,
      onSelect: open.stats!,
    });
  }

  const snapshotSupported =
    instance.provider === "aws" || instance.provider === "azure" || instance.provider === "gcp";
  if (snapshotSupported) {
    items.push({
      kind: "item",
      key: "snapshot",
      label: "Snapshots…",
      icon: Camera,
      onSelect: () =>
        router.push(`/instances/${encodeURIComponent(instance.id)}#snapshots`),
    });
  }

  items.push({ kind: "separator", key: "sep2" });

  items.push({
    kind: "item",
    key: "open",
    label: "Open details",
    icon: ExternalLink,
    onSelect: () => router.push(`/instances/${encodeURIComponent(instance.id)}`),
  });
  items.push({
    kind: "item",
    key: "copy-id",
    label: "Copy instance ID",
    icon: Copy,
    onSelect: copyId,
  });
  if (instance.publicIp) {
    items.push({
      kind: "item",
      key: "copy-ip",
      label: "Copy public IP",
      icon: Copy,
      onSelect: copyIp,
    });
  }
  items.push({
    kind: "item",
    key: "sync",
    label: "Sync this account",
    icon: RefreshCw,
    onSelect: syncNow,
    disabled: pending,
  });

  items.push({ kind: "separator", key: "sep3" });
  items.push({
    kind: "item",
    key: "terminate",
    label: "Terminate…",
    icon: Trash2,
    onSelect: () => run("terminate"),
    danger: true,
    disabled: pending,
  });

  return items;
}
