"use client";

import { Alert, Badge, Button, PageSection } from "@/components/ui";
import { getInstanceLogsAction } from "@/server/actions/metrics";
import { Download, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

interface Props {
  accountId: string;
  providerInstanceId: string;
}

export function ConsoleLogsCard({ accountId, providerInstanceId }: Props) {
  const t = useTranslations("vm.logs");
  const format = useFormatter();
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
    <PageSection
      title={
        <span className="inline-flex items-center gap-2">
          {t("title")}
          {source && <Badge variant="muted" className="text-[10px]">{source}</Badge>}
        </span>
      }
      description={t("description")}
      action={
        <>
          <Button variant="ghost" size="sm" onClick={download} disabled={!text} aria-label={t("download")}>
            <Download className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" onClick={reload} loading={pending} aria-label={t("refresh")}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {error && (
          <Alert tone="danger" className="text-xs">
            {error}
          </Alert>
        )}
        {note && (
          <Alert tone="info" className="text-xs">
            {note}
          </Alert>
        )}
        <pre className="max-h-[480px] overflow-auto rounded-[var(--radius-md)] border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-fg shadow-inner">
          {text || (pending ? t("loading") : error ? "" : t("empty"))}
        </pre>
        {fetchedAt && (
          <div className="text-right text-[10px] text-muted">
            {t("fetched", { time: format.dateTime(new Date(fetchedAt), { timeStyle: "medium" }) })}
          </div>
        )}
      </div>
    </PageSection>
  );
}
