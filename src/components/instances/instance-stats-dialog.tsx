"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InstanceStatsPanel } from "./instance-stats-panel";
import type { InstanceRow } from "@/lib/db/schema";

export function InstanceStatsDialog({
  open,
  onOpenChange,
  instance,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instance: InstanceRow;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{instance.name ?? instance.providerInstanceId}</DialogTitle>
          <DialogDescription>
            Realtime resource usage — {instance.provider} · {instance.region}
          </DialogDescription>
        </DialogHeader>
        <InstanceStatsPanel
          accountId={instance.accountId}
          enabled={open}
          intervalMs={1500}
          providerInstanceId={instance.providerInstanceId}
          instanceId={instance.id}
        />
      </DialogContent>
    </Dialog>
  );
}
