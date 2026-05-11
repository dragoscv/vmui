import "server-only";

/**
 * In-process event bus used by the SSE stream at /api/events. Lives on
 * globalThis so dev HMR doesn't lose subscribers. There is exactly one bus
 * per Node process; we never persist or replicate events. If the app
 * crashes, in-flight events are lost — that's fine because they are purely
 * UI hints (the source-of-truth is the SQLite DB).
 *
 * Channels currently published:
 *   - "instance.changed"   { accountId, providerInstanceId, state, prev }
 *   - "sync.completed"     { accountId, region, count, durationMs }
 *   - "snapshot.created"   { accountId, providerInstanceId, snapshotId }
 *
 * Each subscriber gets every event; filtering happens on the consumer side
 * (cheap since payloads are small and listener counts stay in single digits).
 */

export type BusEvent =
  | { channel: "instance.changed"; payload: { accountId: string; providerInstanceId: string; state: string; prev: string | null } }
  | { channel: "sync.completed"; payload: { accountId: string; region: string; count: number; durationMs: number; added?: number; removed?: number; stateChanged?: number } }
  | { channel: "snapshot.created"; payload: { accountId: string; providerInstanceId: string; snapshotId: string } }
  | { channel: "notification.created"; payload: { id: string; category: string; severity: "info" | "success" | "warning" | "error"; title: string } }
  | {
      channel: "alert.fired";
      payload: {
        ruleId: string;
        ruleName: string;
        severity: "info" | "warning" | "critical";
        message: string;
        instanceId: string | null;
        metric: string;
        value: number;
        threshold: number;
      };
    };

type Listener = (e: BusEvent) => void;

interface Bus {
  listeners: Set<Listener>;
}

declare global {
  // eslint-disable-next-line no-var
  var __vmuiEventBus__: Bus | undefined;
}

function ensure(): Bus {
  if (!globalThis.__vmuiEventBus__) {
    globalThis.__vmuiEventBus__ = { listeners: new Set() };
  }
  return globalThis.__vmuiEventBus__;
}

export function publishEvent(event: BusEvent): void {
  const bus = ensure();
  for (const l of bus.listeners) {
    try {
      l(event);
    } catch {
      // swallow — a broken listener must not stop the others
    }
  }
}

export function subscribeEvents(listener: Listener): () => void {
  const bus = ensure();
  bus.listeners.add(listener);
  return () => {
    bus.listeners.delete(listener);
  };
}
