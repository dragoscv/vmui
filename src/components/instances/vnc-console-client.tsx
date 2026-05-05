"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Maximize2,
  Power,
  RotateCw,
  Loader2,
  Wifi,
  WifiOff,
  Keyboard,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type { VncScreenHandle } from "react-vnc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  startBridgeAction,
  getBridgeStatusAction,
} from "@/server/actions/local-kvm";
import { instanceAction } from "@/server/actions/instances";
import { useConfirm } from "@/components/ui/confirm-dialog";

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

export function VncConsoleClient({
  accountId,
  region,
  providerInstanceId,
  instanceName,
}: ConsoleClientProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const vncRef = useRef<VncScreenHandle>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [state, setState] = useState<ConnState>("starting");
  const [error, setError] = useState<string | null>(null);

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
          setError(r.error ?? "Bridge failed");
          setState("error");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Bridge failed");
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  function sendInstanceAction(action: "stop" | "reboot") {
    void (async () => {
      const ok = await confirm({
        title: action === "stop" ? `Shut down ${instanceName}?` : `Reboot ${instanceName}?`,
        description:
          action === "stop"
            ? "The guest OS will receive an ACPI power-down. Disk data is preserved."
            : "The guest OS will reboot. Unsaved work may be lost.",
        tone: "warning",
        confirmText: action === "stop" ? "Shut down" : "Reboot",
      });
      if (!ok) return;
      const r = await instanceAction(action, { accountId, region, providerInstanceId });
      if (r.ok) toast.success(`${action} requested`);
      else toast.error(r.error ?? "Failed");
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
    <div className="flex h-[calc(100vh-2rem)] flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/instances/${encodeURIComponent(`${accountId}:${region}:${providerInstanceId}`)}`}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
          </Button>
          <div>
            <div className="text-sm font-medium">{instanceName}</div>
            <div className="text-xs text-muted">In-browser console (noVNC)</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConnBadge state={state} />
          <Button variant="ghost" size="sm" onClick={sendCtrlAltDel} title="Send Ctrl+Alt+Del (most-VNC servers)">
            <Keyboard className="h-3.5 w-3.5" /> Ctrl+Alt+Del
          </Button>
          <Button variant="ghost" size="sm" onClick={() => sendInstanceAction("reboot")}>
            <RotateCw className="h-3.5 w-3.5" /> Reboot
          </Button>
          <Button variant="ghost" size="sm" onClick={() => sendInstanceAction("stop")}>
            <Power className="h-3.5 w-3.5" /> Shutdown
          </Button>
          <Button variant="secondary" size="sm" onClick={fullscreen}>
            <Maximize2 className="h-3.5 w-3.5" /> Fullscreen
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div
        id="vnc-canvas-wrap"
        className="relative flex-1 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-black"
      >
        {state === "starting" && <Centered>Starting websocket bridge…</Centered>}
        {state === "error" && (
          <Centered>
            <div className="text-[var(--color-danger)]">{error ?? "Connection failed"}</div>
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
              Retry
            </Button>
          </Centered>
        )}

        {wsUrl && (
          <VncScreen
            ref={vncRef}
            url={wsUrl}
            scaleViewport
            background="#000000"
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
                toast.error("VNC disconnected unexpectedly");
              }
            }}
            onSecurityFailure={(e) => {
              setError(e?.detail?.reason ?? "Security failure");
              setState("error");
            }}
          />
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-2 text-center text-sm text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
        {children}
      </div>
    </div>
  );
}

function ConnBadge({ state }: { state: ConnState }) {
  const [variant, label, Icon] =
    state === "connected"
      ? (["success" as const, "Connected", Wifi] as const)
      : state === "connecting" || state === "starting"
        ? (["info" as const, "Connecting…", Loader2] as const)
        : state === "error"
          ? (["danger" as const, "Error", WifiOff] as const)
          : (["muted" as const, "Disconnected", WifiOff] as const);
  return (
    <Badge variant={variant} className="gap-1.5">
      <Icon className={state === "connecting" || state === "starting" ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
      {label}
    </Badge>
  );
}
