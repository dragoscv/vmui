"use client";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type { InstanceRow } from "@/lib/db/schema";
import { useTranslations } from "next-intl";
import { InstanceStatsPanel } from "./instance-stats-panel";

export function InstanceStatsDialog({
  open,
  onOpenChange,
  instance,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instance: InstanceRow;
}) {
  const t = useTranslations("vm.stats");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{instance.name ?? instance.providerInstanceId}</DialogTitle>
          <DialogDescription>
            {t("dialogDescription", { provider: instance.provider, region: instance.region })}
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
