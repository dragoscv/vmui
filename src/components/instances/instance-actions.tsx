"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import { err, ok } from "@/lib/action-result";
import type { InstanceRow } from "@/lib/db/schema";
import { instanceAction } from "@/server/actions/instances";
import { checkSnapshotFreshness } from "@/server/actions/snapshot-freshness";
import { Play, Plug, RotateCw, Square, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { ConnectDialog } from "./connect-dialog";

type Action = "start" | "stop" | "reboot" | "terminate";
const REQUESTED = {
  start: "startRequested",
  stop: "stopRequested",
  reboot: "rebootRequested",
  terminate: "terminateRequested",
} as const;

export function InstanceActions({ instance }: { instance: InstanceRow }) {
  const t = useTranslations("vm.actions");
  const [openConnect, setOpenConnect] = useState(false);
  const [inFlight, setInFlight] = useState<Action | null>(null);
  const lastAction = useRef<Action>("start");
  const confirm = useConfirm();

  const name = instance.name ?? instance.providerInstanceId;
  const target = {
    accountId: instance.accountId,
    region: instance.region,
    providerInstanceId: instance.providerInstanceId,
  };

  const { run: runAction, pending } = useAction(
    async (a: Action) => {
      const r = await instanceAction(a, target);
      return r.ok ? ok() : err(r.error ?? "common.error");
    },
    { success: () => t(REQUESTED[lastAction.current]) },
  );

  async function run(action: Action) {
    if (action === "terminate") {
      const freshness = await checkSnapshotFreshness(target);
      const warning = !freshness.hasAny
        ? t("terminateNoSnapshot")
        : !freshness.hasRecent
          ? t("terminateOldSnapshot", { days: freshness.daysSince ?? 0 })
          : null;
      const ok = await confirm({
        title: t("confirmTerminateTitle", { name }),
        description: (
          <>
            {t.rich("confirmTerminateBody", { b: (c) => <b>{c}</b> })}
            {warning && (
              <Alert tone="warning" className="mt-2 text-xs">
                {warning}
              </Alert>
            )}
          </>
        ),
        tone: "danger",
        confirmText: t("terminate"),
        requireText: t("typeToConfirm"),
      });
      if (!ok) return;
    } else if (action === "stop") {
      const ok = await confirm({
        title: t("confirmStopTitle", { name }),
        description: t("confirmStopBody"),
        tone: "warning",
        confirmText: t("stop"),
      });
      if (!ok) return;
    } else if (action === "reboot") {
      const ok = await confirm({
        title: t("confirmRebootTitle", { name }),
        description: t("confirmRebootBody"),
        tone: "warning",
        confirmText: t("reboot"),
      });
      if (!ok) return;
    }
    lastAction.current = action;
    setInFlight(action);
    await runAction(action);
    setInFlight(null);
  }

  const isRunning = instance.state === "running";
  const isStopped = instance.state === "stopped";

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpenConnect(true)}
            disabled={!isRunning}
          >
            <Plug className="h-3.5 w-3.5" aria-hidden /> {t("connect")}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isRunning ? t("connectHint") : t("startToConnect")}</TooltipContent>
      </Tooltip>

      {isStopped && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("start")}
              onClick={() => run("start")}
              loading={pending && inFlight === "start"}
              disabled={pending}
            >
              <Play className="h-4 w-4 text-success" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("start")}</TooltipContent>
        </Tooltip>
      )}
      {isRunning && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("stop")}
              onClick={() => run("stop")}
              loading={pending && inFlight === "stop"}
              disabled={pending}
            >
              <Square className="h-4 w-4" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("stop")}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("reboot")}
            onClick={() => run("reboot")}
            loading={pending && inFlight === "reboot"}
            disabled={pending || !isRunning}
          >
            <RotateCw className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("reboot")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("terminate")}
            onClick={() => run("terminate")}
            loading={pending && inFlight === "terminate"}
            disabled={pending}
          >
            <Trash2 className="h-4 w-4 text-danger" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("terminate")}</TooltipContent>
      </Tooltip>

      <ConnectDialog open={openConnect} onOpenChange={setOpenConnect} instance={instance} />
    </div>
  );
}
