"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Square, Trash2 } from "lucide-react";

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
  if (/error|fail|denied/i.test(line)) return "text-red-500";
  if (/warn/i.test(line)) return "text-amber-500";
  if (/success|done|ready|finished/i.test(line)) return "text-emerald-500";
  return "text-[var(--color-fg-soft)]";
}

export function CloudInitStream({ instanceId, platform }: Props) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "streaming" | "error" | "ended">("idle");
  const [error, setError] = useState<string | null>(null);
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
          setError(d.message ?? "stream error");
        } catch {
          setError("stream error");
        }
      } else {
        setError("connection closed");
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Cloud-init / Bootstrap log</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase text-muted">{status}</span>
          {status === "streaming" || status === "connecting" ? (
            <Button size="sm" variant="ghost" onClick={stop}>
              <Square className="mr-1 h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={start} disabled={!supported}>
              <Play className="mr-1 h-3.5 w-3.5" /> {lines.length > 0 ? "Resume" : "Stream"}
            </Button>
          )}
          {lines.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setLines([])}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!supported ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-4 text-xs text-muted">
            Log streaming is currently supported on Linux and macOS only.
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-2 rounded-[var(--radius-md)] border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-300">
                {error}
              </div>
            )}
            <div
              ref={scrollerRef}
              className="max-h-[420px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-2 font-mono text-[11px] leading-tight"
            >
              {lines.length === 0 ? (
                <div className="grid place-items-center py-8 text-xs text-muted">
                  Click Stream to tail <code>/var/log/cloud-init*.log</code>.
                </div>
              ) : (
                lines.map((l, i) => (
                  <div key={i} className={classify(l.text)}>
                    {l.text}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
