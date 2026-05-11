import "server-only";
import { listContainersOnInstance } from "@/lib/containers";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const interval = Math.min(Math.max(Number(url.searchParams.get("interval") ?? "5"), 3), 60) * 1000;

  let stopped = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const tick = async () => {
        if (stopped) return;
        try {
          const data = await listContainersOnInstance(id);
          send("snapshot", data);
        } catch (err) {
          send("error", { message: err instanceof Error ? err.message : "failed" });
        }
      };
      await tick();
      const handle = setInterval(tick, interval);
      req.signal.addEventListener("abort", () => {
        stopped = true;
        clearInterval(handle);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
