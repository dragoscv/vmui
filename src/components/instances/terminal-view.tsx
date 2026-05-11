"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** ws:// URL produced by an open*SshAction call. */
  wsUrl: string;
  /** Friendly label shown above the terminal. */
  label?: string;
  /** Reconnect handler — should call the server action again to mint a new token. */
  onReconnect?: () => void;
}

type Phase = "connecting" | "ready" | "closed" | "error";

export function TerminalView({ wsUrl, label, onReconnect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerminal({
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      theme: {
        background: "#0b0d12",
        foreground: "#e7eaf2",
        cursor: "#7aa2f7",
        selectionBackground: "rgba(122, 162, 247, 0.3)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      // Send initial size right away; server will use it when opening the shell.
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (evt) => {
      if (typeof evt.data === "string") {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "ready") {
            setPhase("ready");
            term.focus();
          } else if (msg.type === "error") {
            setErrorMsg(msg.message ?? "SSH error");
            setPhase("error");
          } else if (msg.type === "close") {
            setPhase("closed");
          }
        } catch {
          term.write(evt.data);
        }
      } else {
        const buf = new Uint8Array(evt.data as ArrayBuffer);
        term.write(buf);
      }
    };
    ws.onerror = () => {
      if (phase === "connecting") {
        setErrorMsg("WebSocket connection failed.");
        setPhase("error");
      }
    };
    ws.onclose = () => {
      setPhase((p) => (p === "ready" ? "closed" : p));
    };

    const onData = term.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    function handleResize() {
      try {
        fit.fit();
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("resize", handleResize);
    const ro = new ResizeObserver(handleResize);
    ro.observe(containerRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      ro.disconnect();
      onData.dispose();
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      term.dispose();
    };
  }, [wsUrl]);

  return (
    <div className="flex h-full min-h-[60vh] flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[#0b0d12] shadow-[var(--shadow-glow)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-xs">
        <div className="flex items-center gap-2 text-muted">
          <span className={dotClass(phase)} />
          <span>{statusLabel(phase)}</span>
          {label && <span className="text-[var(--color-fg)]">· {label}</span>}
        </div>
        {(phase === "closed" || phase === "error") && onReconnect && (
          <Button size="sm" variant="secondary" onClick={onReconnect}>
            <RefreshCw className="h-3.5 w-3.5" /> Reconnect
          </Button>
        )}
      </div>
      <div className="relative flex-1">
        {phase === "connecting" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Negotiating SSH…
          </div>
        )}
        {phase === "error" && errorMsg && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-6 text-center text-xs text-[var(--color-danger)]">
            <AlertCircle className="h-5 w-5" />
            {errorMsg}
          </div>
        )}
        <div ref={containerRef} className="h-full w-full px-2 py-2" />
      </div>
    </div>
  );
}

function statusLabel(p: Phase) {
  switch (p) {
    case "connecting":
      return "connecting…";
    case "ready":
      return "live";
    case "closed":
      return "session ended";
    case "error":
      return "error";
  }
}

function dotClass(p: Phase) {
  const base = "inline-block h-1.5 w-1.5 rounded-full";
  switch (p) {
    case "ready":
      return `${base} bg-[var(--color-success)] shadow-[0_0_8px_var(--color-success)]`;
    case "connecting":
      return `${base} bg-[var(--color-warning)] animate-pulse`;
    case "error":
      return `${base} bg-[var(--color-danger)]`;
    default:
      return `${base} bg-[var(--color-border)]`;
  }
}
