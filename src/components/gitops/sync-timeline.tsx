"use client";

import { RelativeTime } from "@/components/settings/relative-time";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { GitSourceLite, HistoryRow } from "./types";

type StepState = "done" | "running" | "failed" | "idle";

const DOT: Record<StepState, string> = {
  done: "bg-success",
  running: "bg-primary pulse-dot",
  failed: "bg-danger",
  idle: "bg-[color-mix(in_oklch,var(--color-fg)_25%,transparent)]",
};

const TONE: Record<StepState, "success" | "info" | "danger" | "muted"> = {
  done: "success",
  running: "info",
  failed: "danger",
  idle: "muted",
};

export function sourceState(src: GitSourceLite, syncing: boolean): StepState {
  if (syncing) return "running";
  if (src.lastError) return "failed";
  if (!src.enabled) return "idle";
  return src.lastSyncedAt ? "done" : "idle";
}

/** Poll → fetch → match → apply, derived from the source row and its last apply. */
export function SyncTimeline({ src, history, syncing }: { src: GitSourceLite; history: HistoryRow[]; syncing: boolean }) {
  const t = useTranslations("ops.gitops");
  const last = history[0];
  const failed = src.lastError !== null || last?.status === "failed";

  const steps: { id: string; label: string; detail: React.ReactNode; state: StepState }[] = [
    {
      id: "poll",
      label: t("steps.poll"),
      detail: t("steps.pollDetail", { seconds: src.pollSeconds }),
      state: src.enabled ? "done" : "idle",
    },
    {
      id: "fetch",
      label: t("steps.fetch"),
      detail: src.lastSyncedAt ? <RelativeTime date={src.lastSyncedAt} /> : t("steps.never"),
      state: syncing ? "running" : src.lastError ? "failed" : src.lastSyncedAt ? "done" : "idle",
    },
    {
      id: "match",
      label: t("steps.match"),
      detail: <span className="font-mono">{src.composeGlob}</span>,
      state: src.lastCommit ? "done" : "idle",
    },
    {
      id: "apply",
      label: t("steps.apply"),
      detail: last ? <span className="font-mono">{last.path}</span> : t("steps.noApplies"),
      state: failed ? "failed" : last?.status === "success" ? "done" : "idle",
    },
  ];

  return (
    <ol className="space-y-3" aria-label={t("steps.title")}>
      {steps.map((s, i) => (
        <li key={s.id} className="flex min-w-0 items-start gap-3">
          <span className="relative flex shrink-0 flex-col items-center self-stretch pt-1.5">
            <span className={cn("size-2.5 rounded-full", DOT[s.state])} aria-hidden />
            {i < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{s.label}</span>
              <Badge variant={TONE[s.state]}>{t(`stepState.${s.state}`)}</Badge>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted">{s.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
