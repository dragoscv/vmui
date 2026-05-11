import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { subscribeProbePump } from "@/lib/probe-pump";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_INTERVAL_SEC = 10;
const MIN_INTERVAL_SEC = 5;
const MAX_INTERVAL_SEC = 600;

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
  if (inst.platform !== "linux" && inst.platform !== "macos") {
    return new Response(JSON.stringify({ error: `Probe stream not supported on ${inst.platform}` }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const requested = Number(url.searchParams.get("interval") ?? inst.probeIntervalSec ?? DEFAULT_INTERVAL_SEC);
  const intervalSec = Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Number.isFinite(requested) ? requested : DEFAULT_INTERVAL_SEC));

  const enc = new TextEncoder();
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  let keepalive: NodeJS.Timeout | null = null;

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
      send("hello", { instanceId: id, intervalSec });

      const handle = subscribeProbePump(id, intervalSec * 1000, (m) => send("sample", m));
      unsubscribe = handle.unsubscribe;
      if (handle.initial) send("sample", handle.initial);

      keepalive = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* */
        }
      }, 15_000);
      if (typeof keepalive.unref === "function") keepalive.unref();

      req.signal.addEventListener("abort", () => {
        cancelled = true;
        if (keepalive) clearInterval(keepalive);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* */
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
