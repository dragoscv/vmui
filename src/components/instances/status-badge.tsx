"use client";

import { Badge } from "@/components/ui/badge";
import type { NormalizedState } from "@/lib/providers/types";
import { useTranslations } from "next-intl";

const map: Record<NormalizedState, { variant: Parameters<typeof Badge>[0]["variant"]; dot?: boolean }> = {
  running: { variant: "success", dot: true },
  pending: { variant: "warning", dot: true },
  stopping: { variant: "warning", dot: true },
  "shutting-down": { variant: "warning", dot: true },
  stopped: { variant: "muted" },
  terminated: { variant: "danger" },
  unknown: { variant: "muted" },
};

export function StatusBadge({ state, className }: { state: string; className?: string }) {
  const t = useTranslations("vm.state");
  const key = (state in map ? state : "unknown") as NormalizedState;
  const cfg = map[key];
  return (
    <Badge variant={cfg.variant} dot={cfg.dot} className={className}>
      {t(key)}
    </Badge>
  );
}
