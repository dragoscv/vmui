import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { provisionCodaiEnvironment, type ProvisionEvent } from "@/lib/codai/provision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  projectId: z.string().uuid().optional(),
  projectName: z.string().trim().min(1).max(80).optional(),
  environmentName: z.string().trim().min(1).max(80),
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * POST → text/event-stream of `step` / `line` / `done` / `error` events while
 * the codaid installer runs over SSH. POST (not GET) because it mutates codai
 * state; the client reads the body with `fetch` + a stream reader.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let by: string | undefined;
  try {
    by = (await requireRole("operator"))?.email ?? undefined;
  } catch (e) {
    return json(403, { error: e instanceof Error ? e.message : "Forbidden" });
  }
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? "Bad input" });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (ev: ProvisionEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);
      keepalive.unref?.();
      const finish = () => {
        clearInterval(keepalive);
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", finish);
      void provisionCodaiEnvironment({ instanceId: id, ...parsed.data }, send, { signal: req.signal, by })
        .catch(() => {
          /* already emitted as an `error` event */
        })
        .finally(finish);
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
