import { Badge } from "@/components/ui/badge";
import type { NormalizedState } from "@/lib/providers/types";

const map: Record<NormalizedState, { label: string; variant: Parameters<typeof Badge>[0]["variant"]; dot?: boolean }> = {
  running: { label: "Running", variant: "success", dot: true },
  pending: { label: "Pending", variant: "warning", dot: true },
  stopping: { label: "Stopping", variant: "warning", dot: true },
  "shutting-down": { label: "Shutting down", variant: "warning", dot: true },
  stopped: { label: "Stopped", variant: "muted" },
  terminated: { label: "Terminated", variant: "danger" },
  unknown: { label: "Unknown", variant: "muted" },
};

export function StatusBadge({ state }: { state: string }) {
  const cfg = map[state as NormalizedState] ?? map.unknown;
  return (
    <Badge variant={cfg.variant} dot={cfg.dot}>
      {cfg.label}
    </Badge>
  );
}
