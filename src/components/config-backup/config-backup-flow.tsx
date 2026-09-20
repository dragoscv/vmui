"use client";

import { LogViewer } from "@/components/ops/log-viewer";
import { Alert, Badge, Button, Field, Input, PageSection, Progress } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CheckCircle2, Download, FileJson, RotateCcw, Search, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

type Step = "export" | "pick" | "dryRun" | "restore";
const STEPS: Step[] = ["export", "pick", "dryRun", "restore"];

interface ImportReport {
  ok?: boolean;
  error?: string;
  dryRun?: boolean;
  wouldRestore?: Record<string, number>;
  restored?: Record<string, number>;
}

export function ConfigBackupFlow() {
  const t = useTranslations("ops.configBackup");
  const tc = useTranslations("common");
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"dryRun" | "restore" | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [restored, setRestored] = useState(false);

  const stepIndex: number = restored ? STEPS.length : report?.dryRun ? 3 : file ? 2 : 1;

  async function runImport(f: File, apply: boolean) {
    setBusy(apply ? "restore" : "dryRun");
    try {
      const text = await f.text();
      const res = await fetch(`/api/config/import${apply ? "?confirm=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });
      const json = (await res.json()) as ImportReport;
      setReport(json);
      if (!res.ok) toast.error(json.error ?? t("importFailed"));
      else {
        toast.success(apply ? t("restoreDone") : t("dryRunDone"));
        if (apply) setRestored(true);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("importFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function onRestore() {
    if (!file) {
      toast.error(t("repickFile"));
      return;
    }
    const yes = await confirm({
      title: t("confirmTitle"),
      description: t("confirmDescription"),
      tone: "danger",
      confirmText: t("confirmButton"),
      cancelText: tc("cancel"),
      requireText: t("confirmWord"),
    });
    if (yes) await runImport(file, true);
  }

  function reset() {
    setFile(null);
    setReport(null);
    setRestored(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const reportText = report ? JSON.stringify(report, null, 2) : "";
  const summary = report?.restored ?? report?.wouldRestore;
  const total = summary ? Object.values(summary).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <Progress value={stepIndex} max={STEPS.length} label={t("progress", { step: Math.min(stepIndex, STEPS.length), total: STEPS.length })} tone={restored ? "success" : "default"} />

      <PageSection
        title={t("steps.export.title")}
        description={t("steps.export.description")}
        action={<Badge variant="muted">{t("stepBadge", { n: 1 })}</Badge>}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <a href="/api/config/export" download>
              <Download className="size-4" aria-hidden /> {t("steps.export.download")}
            </a>
          </Button>
          <p className="text-xs text-fg-muted">{t("steps.export.excluded")}</p>
        </div>
      </PageSection>

      <PageSection
        title={t("steps.pick.title")}
        description={t("steps.pick.description")}
        action={<Badge variant={file ? "success" : "muted"}>{t("stepBadge", { n: 2 })}</Badge>}
      >
        <Field label={t("steps.pick.fileLabel")} hint={t("steps.pick.fileHint")}>
          <Input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            disabled={busy !== null}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0] ?? null;
              setFile(f);
              setReport(null);
              setRestored(false);
              if (f) void runImport(f, false);
            }}
            className="h-auto cursor-pointer py-1.5 file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-bg-muted file:px-2 file:py-1 file:text-xs file:font-medium file:text-fg"
          />
        </Field>
        {file && (
          <p className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
            <FileJson className="size-3.5" aria-hidden />
            <span className="truncate">{file.name}</span>
            <Badge variant="muted">{t("steps.pick.size", { kb: Math.max(1, Math.round(file.size / 1024)) })}</Badge>
          </p>
        )}
      </PageSection>

      <PageSection
        title={t("steps.dryRun.title")}
        description={t("steps.dryRun.description")}
        action={<Badge variant={report?.dryRun ? "success" : "muted"}>{t("stepBadge", { n: 3 })}</Badge>}
      >
        <div className="space-y-3">
          <Button variant="secondary" disabled={!file || busy !== null} loading={busy === "dryRun"} onClick={() => file && void runImport(file, false)}>
            <Search className="size-4" aria-hidden /> {t("steps.dryRun.run")}
          </Button>
          {report && (
            <LogViewer
              title={report.dryRun ? t("steps.dryRun.reportTitle") : t("steps.restore.reportTitle")}
              text={reportText}
              height="max-h-72"
              autoScroll={false}
              wrap
              lineTone={(line) => (line.includes('"error"') ? "danger" : undefined)}
            />
          )}
          {report?.dryRun && summary && (
            <Alert tone="info" title={t("steps.dryRun.summaryTitle", { total })}>
              {t("steps.dryRun.summaryHint")}
            </Alert>
          )}
        </div>
      </PageSection>

      <PageSection
        title={t("steps.restore.title")}
        description={t("steps.restore.description")}
        action={<Badge variant={restored ? "success" : "muted"}>{t("stepBadge", { n: 4 })}</Badge>}
      >
        <div className="space-y-3">
          {restored ? (
            <Alert tone="success" title={t("steps.restore.doneTitle")} icon={<CheckCircle2 />}>
              {t("steps.restore.doneHint", { total })}
            </Alert>
          ) : (
            <Alert tone="warning" title={t("steps.restore.warningTitle")}>
              {t("steps.restore.warningHint")}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={!report?.dryRun || !file || busy !== null || restored} loading={busy === "restore"} onClick={() => void onRestore()}>
              <Upload className="size-4" aria-hidden /> {t("steps.restore.confirm")}
            </Button>
            {(file || report) && (
              <Button variant="ghost" disabled={busy !== null} onClick={reset}>
                <RotateCcw className="size-4" aria-hidden /> {t("startOver")}
              </Button>
            )}
          </div>
        </div>
      </PageSection>
    </>
  );
}
