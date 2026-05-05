"use client";

import { useTransition, useState } from "react";
import { Play, Square, RotateCw, Trash2, Plug } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { instanceAction } from "@/server/actions/instances";
import type { InstanceRow } from "@/lib/db/schema";
import { ConnectDialog } from "./connect-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function InstanceActions({ instance }: { instance: InstanceRow }) {
  const [pending, start] = useTransition();
  const [openConnect, setOpenConnect] = useState(false);
  const router = useRouter();
  const confirm = useConfirm();

  const label = instance.name ?? instance.providerInstanceId;

  async function run(action: "start" | "stop" | "reboot" | "terminate") {
    if (action === "terminate") {
      const ok = await confirm({
        title: `Terminate ${label}?`,
        description: (
          <>
            This permanently destroys the instance and any data on its
            non-persistent volumes. <b>This cannot be undone.</b>
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
        description:
          "The VM will shut down. You can start it again later — disk data is preserved.",
        tone: "warning",
        confirmText: "Stop",
      });
      if (!ok) return;
    } else if (action === "reboot") {
      const ok = await confirm({
        title: `Reboot ${label}?`,
        description: "The VM will restart. Unsaved work in the guest may be lost.",
        tone: "warning",
        confirmText: "Reboot",
      });
      if (!ok) return;
    }

    start(async () => {
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

  const isRunning = instance.state === "running";
  const isStopped = instance.state === "stopped";

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpenConnect(true)}
            disabled={!isRunning}
          >
            <Plug className="h-3.5 w-3.5" /> Connect
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isRunning ? "Open connection options" : "Start instance to connect"}</TooltipContent>
      </Tooltip>

      {isStopped && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => run("start")} disabled={pending}>
              <Play className="h-4 w-4 text-[var(--color-success)]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Start</TooltipContent>
        </Tooltip>
      )}
      {isRunning && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => run("stop")} disabled={pending}>
              <Square className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Stop</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={() => run("reboot")} disabled={pending || !isRunning}>
            <RotateCw className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reboot</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={() => run("terminate")} disabled={pending}>
            <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Terminate</TooltipContent>
      </Tooltip>

      <ConnectDialog open={openConnect} onOpenChange={setOpenConnect} instance={instance} />
    </div>
  );
}
