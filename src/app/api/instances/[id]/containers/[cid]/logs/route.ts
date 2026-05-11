import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cloudAccounts, instances } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { startSshStream } from "@/lib/ssh-exec-stream";
import type { ProbeKey } from "@/lib/probe";
import { redactQuiet } from "@/lib/secret-redactor";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  const { id, cid } = await params;
  const url = new URL(req.url);
  const runtime = (url.searchParams.get("rt") ?? "docker").toLowerCase();
  const safeCid = cid.replace(/[^a-zA-Z0-9_.\-]/g, "");
  const safeRt = ["docker", "podman", "nerdctl"].includes(runtime) ? runtime : "docker";

  const inst = await db.query.instances.findFirst({ where: eq(instances.id, id) });
  if (!inst) return new Response("Not found", { status: 404 });
  const acc = await db.query.cloudAccounts.findFirst({ where: eq(cloudAccounts.id, inst.accountId) });
  if (!acc?.probeKeyEnc) return new Response("No probe key", { status: 400 });
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  const host = inst.publicIp ?? inst.publicDns;
  if (!host) return new Response("No host", { status: 400 });
  const user = key.defaultUser ?? (inst.provider === "aws" ? "ec2-user" : "ubuntu");

  const cmd =
    safeRt === "nerdctl"
      ? `sudo -n nerdctl logs --tail=200 -f ${safeCid} 2>&1 || nerdctl logs --tail=200 -f ${safeCid} 2>&1`
      : `${safeRt} logs --tail=200 -f ${safeCid} 2>&1`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      const handle = startSshStream({
        host,
        port: 22,
        user,
        key,
        command: cmd,
        onChunk: (text) => {
          for (const line of text.split("\n")) {
            if (line.length === 0) continue;
            send("log", { line: redactQuiet(line) });
          }
        },
        onError: (msg) => send("error", { message: msg }),
        onClose: () => {
          send("close", {});
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        },
      });
      req.signal.addEventListener("abort", () => handle.stop());
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
