import { authEnabled, getCurrentUser } from "@/lib/auth";
import { DEVICES } from "@/lib/home/catalog";
import { ha, haStateChanges } from "@/lib/home/ha-client";
import "server-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const wanted = new Set<string>(["light.hyperhdr", "sensor.dragos_s_s25_ultra_last_notification"]);
for (const d of DEVICES) {
  if (d.entity) wanted.add(d.entity);
  for (const e of d.entities ?? []) wanted.add(e);
}

export async function GET(req: Request) {
  if ((await authEnabled()) && !(await getCurrentUser())) return new Response("unauthorized", { status: 401 });
  if (!ha.configured()) return new Response("home assistant not configured", { status: 503 });

  const enc = new TextEncoder();
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 25_000);
      try {
        send("ready", { at: Date.now() });
        for await (const s of haStateChanges(ac.signal)) {
          if (wanted.has(s.entity_id)) send("state", s);
        }
      } catch (e) {
        send("error", { message: e instanceof Error ? e.message : String(e) });
      } finally {
        clearInterval(ping);
        controller.close();
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
