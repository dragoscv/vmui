import { homeActorOrOwner } from "@/lib/home/access";
import { localizeCard } from "@/lib/notify";
import { runAction } from "@/lib/notify/actions";
import { notifyActor } from "@/lib/notify/auth";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const body = z.object({ id: z.string().min(1), action: z.string().min(1).max(40) });

/** A button on a card was tapped (phone, desktop, web). */
export async function POST(req: NextRequest) {
  const who = await notifyActor(req);
  if (!who) return new NextResponse("forbidden", { status: 403 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  // bound device / session → that member; shared desktop token → the owner (it is their PC);
  // an approved but unbound device gets no household actor and so cannot open the door
  const actor = await homeActorOrOwner(req, who.deviceId === "desktop");
  const r = await runAction(p.data.id, p.data.action, who.by, actor);
  const out = r.ok && r.card ? { ...r, card: await localizeCard(r.card, who.locale) } : r;
  return NextResponse.json(out, { status: r.ok ? 200 : !r.ok && r.error === "forbidden" ? 403 : 400 });
}
