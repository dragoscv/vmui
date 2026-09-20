"use client";

import { Button } from "@/components/ui";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

interface Props {
  /** ws:// URL produced by an open*SshAction call. */
  wsUrl: string;
  /** Friendly label shown above the terminal. */
  label?: string;
  /** Reconnect handler — should call the server action again to mint a new token. */
  onReconnect?: () => void;
}

type Phase = "connecting" | "ready" | "closed" | "error";

function themeFromCss() {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  const primary = v("--color-primary");
  return {
    background: v("--color-bg"),
    foreground: v("--color-fg"),
    cursor: primary,
    cursorAccent: v("--color-bg"),
    selectionBackground: withAlpha(primary, 0.3),
    selectionInactiveBackground: withAlpha(primary, 0.18),
  };
}

// xterm only parses rgba()/#rrggbbaa for translucency; anything else goes
// through a canvas that rejects alpha < 1. Resolve the oklch token to rgb first.
function withAlpha(cssColor: string, alpha: number): string | undefined {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r ?? 0}, ${g ?? 0}, ${b ?? 0}, ${alpha})`;
}

export function TerminalView({ wsUrl, label, onReconnect }: Props) {
  const t = useTranslations("vm.terminal");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerminal({
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      theme: themeFromCss(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const themeObserver = new MutationObserver(() => {
      term.options.theme = themeFromCss();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });

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
            setErrorMsg(msg.message ?? tRef.current("sshError"));
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
      setPhase((p) => {
        if (p !== "connecting") return p;
        setErrorMsg(tRef.current("wsFailed"));
        return "error";
      });
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
      themeObserver.disconnect();
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
    <div className="flex h-full min-h-[60vh] flex-col rounded-[var(--radius-lg)] border border-border bg-bg shadow-[var(--shadow-glow)]">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2 text-muted" role="status" aria-live="polite">
          <span className={dotClass(phase)} aria-hidden />
          <span>{t(PHASE_KEY[phase])}</span>
          {label && <span className="truncate text-fg">· {label}</span>}
        </div>
        {(phase === "closed" || phase === "error") && onReconnect && (
          <Button size="sm" variant="secondary" onClick={onReconnect}>
            <RefreshCw className="size-3.5" aria-hidden /> {t("reconnect")}
          </Button>
        )}
      </div>
      <div className="relative flex-1">
        {phase === "connecting" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-muted">
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> {t("negotiating")}
          </div>
        )}
        {phase === "error" && errorMsg && (
          <div
            role="alert"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-6 text-center text-xs text-danger"
          >
            <AlertCircle className="size-5" aria-hidden />
            {errorMsg}
          </div>
        )}
        <div ref={containerRef} className="h-full w-full px-2 py-2" />
      </div>
    </div>
  );
}

const PHASE_KEY = {
  connecting: "connecting",
  ready: "live",
  closed: "ended",
  error: "error",
} as const;

function dotClass(p: Phase) {
  const base = "inline-block h-1.5 w-1.5 rounded-full";
  switch (p) {
    case "ready":
      return `${base} bg-success shadow-[0_0_8px_var(--color-success)]`;
    case "connecting":
      return `${base} bg-warning animate-pulse`;
    case "error":
      return `${base} bg-danger`;
    default:
      return `${base} bg-border`;
  }
}
