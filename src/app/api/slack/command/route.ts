import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { instances, settings } from "@/lib/db/schema";
import { eq, like } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

interface SlackResponse {
  response_type?: "in_channel" | "ephemeral";
  text: string;
}

function reply(text: string, type: "in_channel" | "ephemeral" = "ephemeral"): NextResponse {
  return NextResponse.json<SlackResponse>({ response_type: type, text });
}

function verifySlack(body: string, ts: string | null, sig: string | null, secret: string): boolean {
  if (!ts || !sig) return false;
  const drift = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(drift) || drift > 300) return false;
  const base = `v0:${ts}:${body}`;
  const expected = "v0=" + createHmac("sha256", secret).update(base).digest("hex");
  const a = Buffer.from(expected); const b = Buffer.from(sig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const body = await req.text();
  const cfg = await db.select().from(settings).where(eq(settings.key, "slack_signing_secret")).get();
  const secret = cfg?.value;
  if (secret) {
    const ts = req.headers.get("x-slack-request-timestamp");
    const sig = req.headers.get("x-slack-signature");
    if (!verifySlack(body, ts, sig, secret)) return new NextResponse("invalid signature", { status: 401 });
  }

  const params = new URLSearchParams(body);
  const text = (params.get("text") ?? "").trim();
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();

  if (!cmd || cmd === "help") {
    return reply("Usage: `/vmui list [filter]` · `/vmui status <name>` · `/vmui count`");
  }

  if (cmd === "count") {
    const all = await db.select().from(instances);
    const running = all.filter((i) => i.state === "running").length;
    return reply(`*${all.length}* total VMs · *${running}* running`, "ephemeral");
  }

  if (cmd === "list") {
    const rows = arg
      ? await db.select().from(instances).where(like(instances.name, `%${arg}%`)).limit(20)
      : await db.select().from(instances).limit(20);
    if (rows.length === 0) return reply(`no VMs match "${arg}"`);
    const lines = rows.map((r) => `• \`${r.name ?? r.providerInstanceId}\` (${r.provider}/${r.region}) — *${r.state}*`);
    return reply(lines.join("\n"));
  }

  if (cmd === "status") {
    if (!arg) return reply("usage: `/vmui status <name>`");
    const rows = await db.select().from(instances).where(like(instances.name, `%${arg}%`)).limit(5);
    if (rows.length === 0) return reply(`no VM named like "${arg}"`);
    const lines = rows.map((r) => `*${r.name ?? r.providerInstanceId}* — ${r.state} · ${r.provider}/${r.region} · ${r.publicIp ?? "no public IP"}`);
    return reply(lines.join("\n"));
  }

  return reply(`unknown command: \`${cmd}\``);
}
