"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, RefreshCw, ScrollText, Download } from "lucide-react";
import { getInstanceLogsAction } from "@/server/actions/metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  accountId: string;
  providerInstanceId: string;
}

export function ConsoleLogsCard({ accountId, providerInstanceId }: Props) {
  const [text, setText] = useState<string>("");
  const [source, setSource] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const reload = () => {
    setError(null);
    start(async () => {
      const r = await getInstanceLogsAction(accountId, providerInstanceId);
      if (r.ok) {
        setText(r.data.text);
        setSource(r.data.source);
        setNote(r.data.note ?? null);
        setFetchedAt(r.data.fetchedAt);
      } else {
        setError(r.error);
      }
    });
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, providerInstanceId]);

  const download = () => {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${providerInstanceId}-console.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4" />
            Console output
            {source && <Badge variant="muted" className="text-[10px]">{source}</Badge>}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={download} disabled={!text}>
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={reload} disabled={pending}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && (
          <div className="rounded-md bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] p-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}
        {note && (
          <div className="rounded-md bg-[var(--color-bg-muted)] px-3 py-1.5 text-[11px] text-muted">
            {note}
          </div>
        )}
        <pre className="max-h-[480px] overflow-auto rounded-md border border-[var(--color-border)] bg-black p-3 font-mono text-[11px] leading-relaxed text-[var(--color-fg)] shadow-inner">
          {text || (pending ? "loading…" : error ? "" : "(no console output yet)")}
        </pre>
        {fetchedAt && (
          <div className="text-right text-[10px] text-muted">
            fetched {new Date(fetchedAt).toLocaleTimeString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
