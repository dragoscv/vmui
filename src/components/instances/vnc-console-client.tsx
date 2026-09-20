"use client";

import { Badge, Button } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { err, ok } from "@/lib/action-result";
import { instanceAction } from "@/server/actions/instances";
import { getBridgeStatusAction, startBridgeAction } from "@/server/actions/local-kvm";
import { Keyboard, Loader2, Maximize2, Power, RotateCw, Wifi, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { VncScreenHandle } from "react-vnc";
import { toast } from "sonner";

// react-vnc imports @novnc/novnc which uses browser-only globals.
// Defer it to the client mount step.
const VncScreen = dynamic(() => import("react-vnc").then((m) => m.VncScreen), {
  ssr: false,
});

interface ConsoleClientProps {
  accountId: string;
  region: string;
  providerInstanceId: string;
  instanceName: string;
}

type ConnState = "starting" | "connecting" | "connected" | "disconnected" | "error";
type GuestAction = "stop" | "reboot";

export function VncConsoleClient({
  accountId,
  region,
  providerInstanceId,
  instanceName,
}: ConsoleClientProps) {
  const t = useTranslations("vm.console");
  const ta = useTranslations("vm.actions");
  const tc = useTranslations("common");
  const router = useRouter();
  const confirm = useConfirm();
  const vncRef = useRef<VncScreenHandle>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [state, setState] = useState<ConnState>("starting");
  const [error, setError] = useState<string | null>(null);
  const [canvasBg, setCanvasBg] = useState<string>();
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    setCanvasBg(getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim() || undefined);
  }, []);

  const lastAction = useRef<GuestAction>("stop");
  const { run: runGuestAction, pending: actionPending } = useAction(
    async (action: GuestAction) => {
      const r = await instanceAction(action, { accountId, region, providerInstanceId });
      return r.ok ? ok() : err(r.error ?? "common.error");
    },
    { success: () => ta(lastAction.current === "stop" ? "stopRequested" : "rebootRequested") },
  );

  // 1) Boot the websocket bridge in WSL, then connect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // First try to detect an already-running bridge.
        const existing = await getBridgeStatusAction(accountId);
        if (cancelled) return;
        if (existing.ok && existing.running && existing.url) {
          setWsUrl(existing.url);
          setState("connecting");
          return;
        }
        // Start a new one.
        const r = await startBridgeAction(accountId);
        if (cancelled) return;
        if (r.ok && r.url) {
          setWsUrl(r.url);
          setState("connecting");
        } else {
          setError(r.error ?? tRef.current("bridgeFailed"));
          setState("error");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : tRef.current("bridgeFailed"));
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  function sendInstanceAction(action: GuestAction) {
    void (async () => {
      const ok = await confirm({
        title: action === "stop" ? ta("confirmStopTitle", { name: instanceName }) : ta("confirmRebootTitle", { name: instanceName }),
        description: action === "stop" ? ta("confirmStopBody") : ta("confirmRebootBody"),
        tone: "warning",
        confirmText: action === "stop" ? t("shutdown") : ta("reboot"),
      });
      if (!ok) return;
      lastAction.current = action;
      await runGuestAction(action);
    })();
  }

  function fullscreen() {
    const el = document.getElementById("vnc-canvas-wrap");
    if (el?.requestFullscreen) void el.requestFullscreen();
  }

  function sendCtrlAltDel() {
    vncRef.current?.sendCtrlAltDel();
  }

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[60vh] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ConnBadge state={state} />
        <Button variant="ghost" size="sm" onClick={sendCtrlAltDel} title={t("ctrlAltDelHint")}>
          <Keyboard className="size-3.5" aria-hidden /> {t("ctrlAltDel")}
        </Button>
        <Button variant="ghost" size="sm" disabled={actionPending} onClick={() => sendInstanceAction("reboot")}>
          <RotateCw className="size-3.5" aria-hidden /> {ta("reboot")}
        </Button>
        <Button variant="ghost" size="sm" disabled={actionPending} onClick={() => sendInstanceAction("stop")}>
          <Power className="size-3.5" aria-hidden /> {t("shutdown")}
        </Button>
        <Button variant="secondary" size="sm" onClick={fullscreen}>
          <Maximize2 className="size-3.5" aria-hidden /> {t("fullscreen")}
        </Button>
      </div>

      <div
        id="vnc-canvas-wrap"
        className="relative flex-1 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg"
      >
        {state === "starting" && <Centered spinner>{t("startingBridge")}</Centered>}
        {state === "error" && (
          <Centered>
            <div role="alert" className="text-danger">{error ?? t("connectionFailed")}</div>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => {
                setState("starting");
                setError(null);
                router.refresh();
                setTimeout(() => {
                  // re-trigger effect
                  setWsUrl(null);
                }, 50);
              }}
            >
              {tc("retry")}
            </Button>
          </Centered>
        )}

        {wsUrl && (
          <VncScreen
            ref={vncRef}
            url={wsUrl}
            scaleViewport
            background={canvasBg}
            style={{ width: "100%", height: "100%" }}
            qualityLevel={8}
            compressionLevel={2}
            autoConnect
            retryDuration={3000}
            onConnect={() => {
              setState("connected");
            }}
            onDisconnect={(e) => {
              setState("disconnected");
              if (!e?.detail?.clean) {
                toast.error(tRef.current("disconnectedUnexpectedly"));
              }
            }}
            onSecurityFailure={(e) => {
              setError(e?.detail?.reason ?? tRef.current("securityFailure"));
              setState("error");
            }}
          />
        )}
      </div>
    </div>
  );
}

function Centered({ children, spinner = false }: { children: React.ReactNode; spinner?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-2 text-center text-sm text-muted">
        {spinner && <Loader2 className="size-5 animate-spin" aria-hidden />}
        {children}
      </div>
    </div>
  );
}

function ConnBadge({ state }: { state: ConnState }) {
  const t = useTranslations("vm.console");
  const [variant, key, Icon] =
    state === "connected"
      ? (["success", "connected", Wifi] as const)
      : state === "connecting" || state === "starting"
        ? (["info", "connecting", Loader2] as const)
        : state === "error"
          ? (["danger", "error", WifiOff] as const)
          : (["muted", "disconnected", WifiOff] as const);
  const busy = state === "connecting" || state === "starting";
  return (
    <Badge variant={variant} className="gap-1.5" role="status" aria-live="polite">
      <Icon className={busy ? "size-3 animate-spin" : "size-3"} aria-hidden />
      {t(key)}
    </Badge>
  );
}
