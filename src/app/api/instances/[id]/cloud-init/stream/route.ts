import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cloudAccounts, instances } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { startSshStream } from "@/lib/ssh-exec-stream";
import { redactQuiet } from "@/lib/secret-redactor";
import type { ProbeKey } from "@/lib/probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function defaultUser(platform: string, provider: string): string {
  if (platform === "macos") return "ec2-user";
  switch (provider) {
    case "aws":
      return "ubuntu";
    case "azure":
      return "azureuser";
    case "gcp":
      return "ubuntu";
    case "digitalocean":
    case "hetzner":
    case "scaleway":
      return "root";
    default:
      return "ubuntu";
  }
}

function tailCommand(platform: string): string | null {
  if (platform === "linux") {
    return "sudo -n tail -F -n 200 /var/log/cloud-init.log /var/log/cloud-init-output.log 2>&1 || tail -F -n 200 /var/log/cloud-init.log /var/log/cloud-init-output.log 2>&1";
  }
  if (platform === "macos") {
    return "tail -F -n 200 /var/log/vmui-bootstrap.log 2>&1";
  }
  return null;
}

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

  const cmd = tailCommand(inst.platform);
  if (!cmd) {
    return new Response(JSON.stringify({ error: `Log streaming not supported on ${inst.platform}` }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!inst.publicIp && !inst.publicDns) {
    return new Response(JSON.stringify({ error: "Instance has no public IP/DNS" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const acc = (await db.select().from(cloudAccounts).where(eq(cloudAccounts.id, inst.accountId)).limit(1))[0];
  if (!acc?.probeKeyEnc) {
    return new Response(JSON.stringify({ error: "No probe key configured for this account" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  const host = inst.publicIp ?? inst.publicDns!;
  const user = key.defaultUser ?? defaultUser(inst.platform, inst.provider);

  const enc = new TextEncoder();
  let cancelled = false;
  let handle: { stop(): void } | null = null;
  let keepalive: NodeJS.Timeout | null = null;
  let lineBuf = "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        if (cancelled) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };

      sendEvent("hello", { instanceId: id, platform: inst.platform });

      handle = startSshStream({
        host,
        port: 22,
        user,
        key,
        command: cmd,
        onChunk: (text) => {
          lineBuf += text;
          const parts = lineBuf.split(/\r?\n/);
          lineBuf = parts.pop() ?? "";
          for (const line of parts) {
            if (line.length > 0) sendEvent("line", { ts: Date.now(), text: redactQuiet(line) });
          }
        },
        onError: (msg) => sendEvent("error", { message: msg }),
        onClose: () => {
          if (lineBuf) sendEvent("line", { ts: Date.now(), text: redactQuiet(lineBuf) });
          sendEvent("end", { ok: true });
          try {
            controller.close();
          } catch {
            /* closed */
          }
        },
      });

      keepalive = setInterval(() => {
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
        if (keepalive) clearInterval(keepalive);
        handle?.stop();
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
