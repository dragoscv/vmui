"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { categorizeError } from "@/lib/errors";

interface AuditEvent {
  id: number;
  accountId: string | null;
  action: string;
  target: string | null;
  status: "ok" | "error";
  message: string | null;
  createdAt: string;
}

interface InstanceChangedPayload {
  accountId: string;
  providerInstanceId: string;
  state: string;
  prev: string | null;
}

const QUIET_ACTIONS = new Set(["sync.region"]);

/**
 * Subscribes to /api/events and surfaces important audit-log rows as toasts.
 * Also listens for low-latency bus events (instance.changed, sync.completed)
 * and pings router.refresh() so server components pick up new data.
 */
export function RealtimeListener() {
  const router = useRouter();
  const lastRefresh = useRef(0);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/events");

    const refresh = (minIntervalMs: number) => {
      const now = Date.now();
      if (now - lastRefresh.current > minIntervalMs) {
        lastRefresh.current = now;
        router.refresh();
      }
    };

    es.addEventListener("audit", (raw: MessageEvent) => {
      let ev: AuditEvent;
      try {
        ev = JSON.parse(raw.data) as AuditEvent;
      } catch {
        return;
      }
      if (!QUIET_ACTIONS.has(ev.action)) {
        if (ev.status === "error") {
          const cat = categorizeError(ev.message ?? ev.action);
          const description = cat.hint ? `${cat.message}\n${cat.hint}` : cat.message;
          toast.error(`${ev.action}${ev.target ? ` · ${ev.target}` : ""}`, {
            description,
          });
        } else if (ev.action.startsWith("recipe.") || ev.action.startsWith("sync.")) {
          toast.success(ev.action, { description: ev.target ?? undefined });
        }
      }
      refresh(1500);
    });

    es.addEventListener("instance.changed", (raw: MessageEvent) => {
      try {
        const p = JSON.parse(raw.data) as InstanceChangedPayload;
        // Only surface a toast when the transition is interesting.
        if (p.prev && p.prev !== p.state) {
          toast(`${p.providerInstanceId}: ${p.prev} → ${p.state}`);
        }
      } catch {
        /* ignore */
      }
      refresh(500);
    });

    es.addEventListener("sync.completed", (raw: MessageEvent) => {
      try {
        const p = JSON.parse(raw.data) as {
          accountId: string;
          region: string;
          count: number;
          added?: number;
          removed?: number;
          stateChanged?: number;
        };
        const added = p.added ?? 0;
        const removed = p.removed ?? 0;
        const changed = p.stateChanged ?? 0;
        if (added + removed + changed > 0) {
          const parts: string[] = [];
          if (added) parts.push(`+${added}`);
          if (removed) parts.push(`-${removed}`);
          if (changed) parts.push(`${changed} state change${changed === 1 ? "" : "s"}`);
          toast(`Sync · ${p.region}`, { description: parts.join(" / ") });
        }
      } catch {
        /* ignore */
      }
      refresh(800);
    });

    es.addEventListener("snapshot.created", (raw: MessageEvent) => {
      try {
        const p = JSON.parse(raw.data) as { snapshotId: string };
        toast.success("Snapshot created", { description: p.snapshotId });
      } catch {
        /* ignore */
      }
      refresh(500);
    });

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };

    return () => es.close();
  }, [router]);

  return null;
}
