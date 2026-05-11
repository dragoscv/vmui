"use client";

import { useEffect, useRef, useState } from "react";
import { getInstanceStatsAction } from "@/server/actions/local-kvm";
import type { InstanceStatsSample } from "@/lib/providers/types";

export interface StatsHistory {
  cpu: number[];
  mem: number[];
  diskR: number[];
  diskW: number[];
  netRx: number[];
  netTx: number[];
}

const HISTORY_LEN = 60;

function emptyHistory(): StatsHistory {
  return { cpu: [], mem: [], diskR: [], diskW: [], netRx: [], netTx: [] };
}

function pushBounded(arr: number[], v: number, max = HISTORY_LEN) {
  arr.push(v);
  if (arr.length > max) arr.shift();
}

/**
 * Polls realtime stats for an instance and maintains rolling history rings
 * suitable for sparkline rendering. When `instanceId` is provided we
 * subscribe to the per-instance SSE stream at /api/instances/{id}/stats/stream
 * which is server-pumped and shared across all open tabs — much cheaper
 * than per-tab polling. Falls back to action polling when no instanceId is
 * known (early account-onboarding flows).
 */
export function useInstanceStats(
  accountId: string | null,
  options: {
    enabled?: boolean;
    intervalMs?: number;
    providerInstanceId?: string | null;
    /** Synthetic DB id ${accountId}:${region}:${providerInstanceId}. When set, SSE is used. */
    instanceId?: string | null;
  } = {},
) {
  const { enabled = true, intervalMs = 2000, providerInstanceId = null, instanceId = null } = options;
  const [latest, setLatest] = useState<InstanceStatsSample | null>(null);
  const [history, setHistory] = useState<StatsHistory>(emptyHistory);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // SSE path: server-pumped, shared across tabs.
  useEffect(() => {
    if (!instanceId || !enabled) return;
    if (typeof EventSource === "undefined") return;
    const url = `/api/instances/${encodeURIComponent(instanceId)}/stats/stream?interval=${intervalMs}`;
    const es = new EventSource(url);
    const onStats = (raw: MessageEvent) => {
      try {
        const sample = JSON.parse(raw.data) as InstanceStatsSample;
        setError(null);
        setLatest(sample);
        setHistory((h) => {
          const next: StatsHistory = {
            cpu: h.cpu.slice(),
            mem: h.mem.slice(),
            diskR: h.diskR.slice(),
            diskW: h.diskW.slice(),
            netRx: h.netRx.slice(),
            netTx: h.netTx.slice(),
          };
          pushBounded(next.cpu, Math.min(100, Math.max(0, sample.cpuPercent ?? 0)));
          const memPct =
            sample.memUsedBytes && sample.memTotalBytes
              ? Math.min(100, (sample.memUsedBytes / sample.memTotalBytes) * 100)
              : 0;
          pushBounded(next.mem, memPct);
          pushBounded(next.diskR, sample.diskReadBps ?? 0);
          pushBounded(next.diskW, sample.diskWriteBps ?? 0);
          pushBounded(next.netRx, sample.netRxBps ?? 0);
          pushBounded(next.netTx, sample.netTxBps ?? 0);
          return next;
        });
      } catch {
        /* ignore malformed frame */
      }
    };
    es.addEventListener("stats", onStats);
    es.onerror = () => {
      // EventSource auto-reconnects.
    };
    return () => {
      es.removeEventListener("stats", onStats);
      es.close();
    };
  }, [instanceId, enabled, intervalMs]);

  useEffect(() => {
    // Skip the polling fallback entirely when we have a stream.
    if (instanceId) return;
    if (!accountId || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled || inFlight.current) {
        schedule();
        return;
      }
      if (typeof document !== "undefined" && document.hidden) {
        schedule(intervalMs * 4); // back off when tab hidden
        return;
      }
      inFlight.current = true;
      try {
        const r = await getInstanceStatsAction(accountId!, providerInstanceId ?? undefined);
        if (cancelled) return;
        if (!r.ok) {
          setError(r.error);
        } else {
          setError(null);
          setLatest(r.sample);
          setHistory((h) => {
            const next: StatsHistory = {
              cpu: h.cpu.slice(),
              mem: h.mem.slice(),
              diskR: h.diskR.slice(),
              diskW: h.diskW.slice(),
              netRx: h.netRx.slice(),
              netTx: h.netTx.slice(),
            };
            pushBounded(next.cpu, Math.min(100, Math.max(0, r.sample.cpuPercent ?? 0)));
            const memPct =
              r.sample.memUsedBytes && r.sample.memTotalBytes
                ? Math.min(100, (r.sample.memUsedBytes / r.sample.memTotalBytes) * 100)
                : 0;
            pushBounded(next.mem, memPct);
            pushBounded(next.diskR, r.sample.diskReadBps ?? 0);
            pushBounded(next.diskW, r.sample.diskWriteBps ?? 0);
            pushBounded(next.netRx, r.sample.netRxBps ?? 0);
            pushBounded(next.netTx, r.sample.netTxBps ?? 0);
            return next;
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed");
      } finally {
        inFlight.current = false;
        schedule();
      }
    }

    function schedule(delay = intervalMs) {
      if (cancelled) return;
      timer = setTimeout(tick, delay);
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [accountId, enabled, intervalMs, providerInstanceId, instanceId]);

  return { latest, history, error };
}

export function formatBps(v: number | undefined): string {
  if (v === undefined || v < 0 || !Number.isFinite(v)) return "—";
  if (v < 1024) return `${v.toFixed(0)} B/s`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB/s`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}

export function formatBytes(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  if (v < 1024) return `${v.toFixed(0)} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatUptime(sec: number | undefined): string {
  if (sec === undefined || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
