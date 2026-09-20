"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

export interface IntercomState {
  ringing: boolean;
  ringingSince: number | null;
  lastRingAt: number | null;
  lastOpenAt: number | null;
  autoOpenUntil: number | null;
  log: Array<{ at: number; event: string; by: string }>;
}

export const INTERCOM_KEY = ["intercom"] as const;

/** Electra intercom state, refreshed every 3 s while mounted. `url` lets the
 *  shared-token variant (`/api/esp/intercom?k=…`) reuse the same cache key. */
export function useIntercomState(initial: IntercomState, opts: { url?: string; interval?: number } = {}) {
  const url = opts.url ?? "/api/esp/intercom";
  return useQuery({
    queryKey: [...INTERCOM_KEY, url],
    queryFn: () => getJSON<IntercomState>(url),
    refetchInterval: opts.interval ?? 3000,
    initialData: initial,
    refetchOnWindowFocus: true,
  });
}

export interface PairedDevice {
  id: string;
  name: string;
  platform: string;
  status: string;
  approvedBy: string | null;
  lastSeenAt: string | Date | null;
  lastIp: string | null;
  createdAt: string | Date;
}
export type PendingDevice = PairedDevice & { code: string };
export interface PairedDevicesPayload {
  devices: PairedDevice[];
  pending: PendingDevice[];
  version: number;
}

export const PAIRED_DEVICES_KEY = ["paired-devices"] as const;

/** Long-polls `/api/devices?since=<version>`; the server holds the request
 *  until something changes, so a 1 s interval is effectively "reconnect
 *  right away". Paused while the tab is hidden. */
export function usePairedDevices() {
  const version = React.useRef<number | undefined>(undefined);
  const q = useQuery({
    queryKey: PAIRED_DEVICES_KEY,
    queryFn: async () => {
      const v = version.current;
      const j = await getJSON<PairedDevicesPayload>(`/api/devices${v === undefined ? "" : `?since=${v}`}`);
      version.current = j.version;
      return j;
    },
    refetchInterval: (query) => (query.state.status === "error" ? 5000 : 1000),
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  });
  return { ...q, pending: q.data?.pending ?? [] };
}

export type EventSourceStatus = "connecting" | "open" | "error";

export interface EventSourceHandlers<T> {
  /** Named SSE `event:` types to listen for; default `["message"]`. */
  events?: string[];
  onMessage?: (data: T, event: string, raw: MessageEvent) => void;
  onOpen?: () => void;
  onError?: (attempt: number) => void;
  parse?: (raw: string) => T;
}

/** Owns an EventSource with exponential reconnect (1 s → 30 s). `url = null`
 *  disconnects. Handlers are read from a ref, so inline closures are fine. */
export function useEventSource<T = unknown>(url: string | null, handlers: EventSourceHandlers<T> = {}): { status: EventSourceStatus; attempt: number } {
  const [status, setStatus] = React.useState<EventSourceStatus>("connecting");
  const [attempt, setAttempt] = React.useState(0);
  const h = React.useRef(handlers);
  h.current = handlers;
  const eventNames = (handlers.events ?? ["message"]).join("\u0000");

  React.useEffect(() => {
    if (!url) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    let alive = true;

    const connect = () => {
      if (!alive) return;
      setStatus("connecting");
      es = new EventSource(url);
      const parse = h.current.parse ?? ((raw: string) => JSON.parse(raw) as T);
      const onEvent = (ev: Event) => {
        const me = ev as MessageEvent<string>;
        let data: T;
        try {
          data = parse(me.data);
        } catch {
          return;
        }
        h.current.onMessage?.(data, me.type, me);
      };
      for (const name of eventNames.split("\u0000")) es.addEventListener(name, onEvent);
      es.onopen = () => {
        tries = 0;
        setAttempt(0);
        setStatus("open");
        h.current.onOpen?.();
      };
      es.onerror = () => {
        es?.close();
        es = null;
        tries += 1;
        setAttempt(tries);
        setStatus("error");
        h.current.onError?.(tries);
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(tries - 1, 5));
        timer = setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [url, eventNames]);

  return { status, attempt };
}
