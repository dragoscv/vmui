"use client";

import { Alert } from "@/components/ui/alert";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { err, ok } from "@/lib/action-result";
import type { InstanceRow } from "@/lib/db/schema";
import {
    instanceAction,
    setInstancePinnedAction,
    syncAccountInstances,
} from "@/server/actions/instances";
import { checkSnapshotFreshness } from "@/server/actions/snapshot-freshness";
import {
    BarChart3,
    Camera,
    Copy,
    ExternalLink,
    Pencil,
    Pin,
    PinOff,
    Play,
    Plug,
    RefreshCw,
    RotateCw,
    Square,
    StickyNote,
    Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useRef } from "react";
import { toast } from "sonner";
import { instanceLabel } from "./instance-label";

type Action = "start" | "stop" | "reboot" | "terminate";
const REQUESTED = {
  start: "startRequested",
  stop: "stopRequested",
  reboot: "rebootRequested",
  terminate: "terminateRequested",
} as const;

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
  const t = useTranslations("vm.menu");
  const ta = useTranslations("vm.actions");
  const confirm = useConfirm();
  const label = instanceLabel(instance);
  const isRunning = instance.state === "running";
  const isStopped = instance.state === "stopped";
  const showStats =
    instance.provider === "local-kvm" && instance.state === "running" && !!open.stats;
  const target = {
    accountId: instance.accountId,
    region: instance.region,
    providerInstanceId: instance.providerInstanceId,
  };
  const lastAction = useRef<Action>("start");

  const lifecycle = useAction(
    async (a: Action) => {
      const r = await instanceAction(a, target);
      return r.ok ? ok() : err(r.error ?? "common.error");
    },
    { success: () => ta(REQUESTED[lastAction.current]) },
  );
  const pin = useAction(
    async () => {
      const r = await setInstancePinnedAction({ id: instance.id, pinned: !instance.pinned });
      return r.ok ? ok() : err(r.error ?? "common.error");
    },
    { success: () => t(instance.pinned ? "unpinnedToast" : "pinnedToast") },
  );
  const sync = useAction(
    async () => ok(await syncAccountInstances(instance.accountId)),
    { success: (d) => t("synced", { count: d.count }), error: t("syncFailed") },
  );
  const pending = lifecycle.pending || pin.pending || sync.pending;

  async function run(action: Action) {
    if (action === "terminate") {
      const freshness = await checkSnapshotFreshness(target);
      const warning = !freshness.hasAny
        ? ta("terminateNoSnapshot")
        : !freshness.hasRecent
          ? ta("terminateOldSnapshot", { days: freshness.daysSince ?? 0 })
          : null;
      const confirmed = await confirm({
        title: ta("confirmTerminateTitle", { name: label }),
        description: (
          <>
            {ta.rich("confirmTerminateBody", { b: (c) => <b>{c}</b> })}
            {warning && (
              <Alert tone="warning" className="mt-2 text-xs">
                {warning}
              </Alert>
            )}
          </>
        ),
        tone: "danger",
        confirmText: ta("terminate"),
        requireText: ta("typeToConfirm"),
      });
      if (!confirmed) return;
    } else if (action === "stop") {
      const confirmed = await confirm({
        title: ta("confirmStopTitle", { name: label }),
        description: ta("confirmStopBody"),
        tone: "warning",
        confirmText: ta("stop"),
      });
      if (!confirmed) return;
    }
    lastAction.current = action;
    await lifecycle.run(action);
  }

  function copyId() {
    void navigator.clipboard.writeText(instance.providerInstanceId);
    toast.success(t("copiedId"));
  }

  function copyIp() {
    if (!instance.publicIp) return;
    void navigator.clipboard.writeText(instance.publicIp);
    toast.success(t("copiedIp"));
  }

  const items: InstanceMenuItemDescriptor[] = [
    {
      kind: "item",
      key: "connect",
      label: ta("connect"),
      icon: Plug,
      disabled: !isRunning || pending,
      onSelect: open.connect,
    },
  ];

  if (isStopped) {
    items.push({
      kind: "item",
      key: "start",
      label: ta("start"),
      icon: Play,
      disabled: pending,
      onSelect: () => run("start"),
    });
  }
  if (isRunning) {
    items.push({
      kind: "item",
      key: "stop",
      label: ta("stop"),
      icon: Square,
      disabled: pending,
      onSelect: () => run("stop"),
    });
    items.push({
      kind: "item",
      key: "reboot",
      label: ta("reboot"),
      icon: RotateCw,
      disabled: pending,
      onSelect: () => run("reboot"),
    });
  }

  items.push({ kind: "separator", key: "sep1" });

  items.push({
    kind: "item",
    key: "rename",
    label: t("rename"),
    icon: Pencil,
    onSelect: open.rename,
    shortcut: "F2",
  });
  items.push({
    kind: "item",
    key: "pin",
    label: instance.pinned ? t("unpin") : t("pin"),
    icon: instance.pinned ? PinOff : Pin,
    onSelect: () => void pin.run(),
    disabled: pending,
  });
  items.push({
    kind: "item",
    key: "notes",
    label: instance.notes ? t("editNotes") : t("addNotes"),
    icon: StickyNote,
    onSelect: open.notes,
  });

  if (showStats) {
    items.push({
      kind: "item",
      key: "stats",
      label: t("detailedStats"),
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
      label: t("snapshots"),
      icon: Camera,
      onSelect: () =>
        router.push(`/instances/${encodeURIComponent(instance.id)}#snapshots`),
    });
  }

  items.push({ kind: "separator", key: "sep2" });

  items.push({
    kind: "item",
    key: "open",
    label: t("openDetails"),
    icon: ExternalLink,
    onSelect: () => router.push(`/instances/${encodeURIComponent(instance.id)}`),
  });
  items.push({
    kind: "item",
    key: "copy-id",
    label: t("copyId"),
    icon: Copy,
    onSelect: copyId,
  });
  if (instance.publicIp) {
    items.push({
      kind: "item",
      key: "copy-ip",
      label: t("copyIp"),
      icon: Copy,
      onSelect: copyIp,
    });
  }
  items.push({
    kind: "item",
    key: "sync",
    label: t("syncAccount"),
    icon: RefreshCw,
    onSelect: () => void sync.run(),
    disabled: pending,
  });

  items.push({ kind: "separator", key: "sep3" });
  items.push({
    kind: "item",
    key: "terminate",
    label: t("terminate"),
    icon: Trash2,
    onSelect: () => run("terminate"),
    danger: true,
    disabled: pending,
  });

  return items;
}
