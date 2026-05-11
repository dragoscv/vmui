import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { subscribeMetricPump } from "@/lib/metric-pump";
import { getInstanceStatsAction } from "@/server/actions/local-kvm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_INTERVAL_MS = 2000;
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 30_000;

/**
 * Server-sent metric stream for one instance. Multiple browser tabs share
 * one server-side polling loop via {@link subscribeMetricPump} — opening a
 * second tab is free.
 *
 *   GET /api/instances/{id}/stats/stream?interval=2000
 *
 *   event: stats
 *   data: {"sampledAt":...,"running":true,"cpuPercent":12.4,...}
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const inst = (await db.select().from(instances).where(eq(instances.id, id)).limit(1))[0];
  if (!inst) {
    return new Response(JSON.stringify({ error: "Instance not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const requested = Number(url.searchParams.get("interval") ?? DEFAULT_INTERVAL_MS);
  const intervalMs = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Number.isFinite(requested) ? requested : DEFAULT_INTERVAL_MS));

  const enc = new TextEncoder();
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (cancelled) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      send("hello", { instanceId: id, intervalMs });

      const handle = subscribeMetricPump(
        `instance:${id}`,
        async () => {
          const r = await getInstanceStatsAction(inst.accountId, inst.providerInstanceId);
          return r.ok ? r.sample : null;
        },
        intervalMs,
        (sample) => send("stats", sample),
      );
      unsubscribe = handle.unsubscribe;
      if (handle.initial) send("stats", handle.initial);

      const keepalive = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* closed */
        }
      }, 15_000);
      if (typeof keepalive.unref === "function") keepalive.unref();

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(keepalive);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
