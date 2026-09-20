"use client";

import { Alert, Badge, Button, PageSection } from "@/components/ui";
import { Play, Square, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

interface LogLine {
  ts: number;
  text: string;
}

interface Props {
  instanceId: string;
  platform: string;
}

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function classify(line: string): string {
  if (/error|fail|denied/i.test(line)) return "text-danger";
  if (/warn/i.test(line)) return "text-warning";
  if (/success|done|ready|finished/i.test(line)) return "text-success";
  return "text-fg-soft";
}

type Status = "idle" | "connecting" | "streaming" | "error" | "ended";
type ErrorKind = "streamError" | "connectionClosed";

export function CloudInitStream({ instanceId, platform }: Props) {
  const t = useTranslations("vm.cloudInit");
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<{ kind: ErrorKind; message?: string } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const supported = platform === "linux" || platform === "macos";

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [lines.length]);

  const start = () => {
    if (!supported) return;
    esRef.current?.close();
    setError(null);
    setStatus("connecting");
    const es = new EventSource(`/api/instances/${instanceId}/cloud-init/stream`);
    esRef.current = es;
    es.addEventListener("hello", () => setStatus("streaming"));
    es.addEventListener("line", (ev) => {
      try {
        const d = JSON.parse((ev as MessageEvent).data) as LogLine;
        setLines((prev) => {
          const next = prev.concat({ ts: d.ts, text: stripAnsi(d.text) });
          return next.length > 2000 ? next.slice(-2000) : next;
        });
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("error", (ev) => {
      const data = (ev as MessageEvent).data;
      if (typeof data === "string") {
        try {
          const d = JSON.parse(data) as { message?: string };
          setError({ kind: "streamError", message: d.message });
        } catch {
          setError({ kind: "streamError" });
        }
      } else {
        setError({ kind: "connectionClosed" });
      }
      setStatus("error");
      es.close();
    });
    es.addEventListener("end", () => {
      setStatus("ended");
      es.close();
    });
  };

  const stop = () => {
    esRef.current?.close();
    setStatus("idle");
  };

  const active = status === "streaming" || status === "connecting";

  return (
    <PageSection
      title={t("title")}
      description={t("description")}
      action={
        <>
          <Badge variant={status === "streaming" ? "success" : status === "error" ? "danger" : "muted"} dot={status === "streaming"}>
            {t(`status.${status}`)}
          </Badge>
          {active ? (
            <Button size="sm" variant="ghost" onClick={stop} loading={status === "connecting"}>
              <Square className="h-3.5 w-3.5" aria-hidden /> {t("stop")}
            </Button>
          ) : (
            <Button size="sm" onClick={start} disabled={!supported}>
              <Play className="h-3.5 w-3.5" aria-hidden /> {lines.length > 0 ? t("resume") : t("stream")}
            </Button>
          )}
          {lines.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setLines([])} aria-label={t("clear")}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </>
      }
    >
      {!supported ? (
        <Alert tone="info" className="text-xs">
          {t("unsupported")}
        </Alert>
      ) : (
        <div className="space-y-2">
          {error && (
            <Alert tone="danger" className="text-xs">
              {error.message ?? t(error.kind)}
            </Alert>
          )}
          <div
            ref={scrollerRef}
            role="log"
            aria-live="polite"
            className="max-h-[420px] overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface-muted p-2 font-mono text-[11px] leading-tight"
          >
            {lines.length === 0 ? (
              <div className="grid place-items-center py-8 text-xs text-muted">
                {t.rich("hint", { code: (c) => <code>{c}</code> })}
              </div>
            ) : (
              lines.map((l, i) => (
                <div key={i} className={classify(l.text)}>
                  {l.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </PageSection>
  );
}
