import { ack, dismiss, listCards, markRead, notify, notifyInputSchema } from "@/lib/notify";
import { notifyActor } from "@/lib/notify/auth";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** GET ?all=1 → history incl. dismissed. */
export async function GET(req: NextRequest) {
  const who = await notifyActor(req);
  if (!who) return new NextResponse("forbidden", { status: 403 });
  const all = req.nextUrl.searchParams.get("all") === "1";
  const cards = await listCards({ includeDismissed: all, limit: all ? 200 : 100 });
  return NextResponse.json({ cards, now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}

const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("read"), ids: z.array(z.string()).max(200) }),
  z.object({ op: z.literal("dismiss"), id: z.string() }),
  z.object({ op: z.literal("dismissAll") }),
  /** a device saw the card (cancels the HA Companion fallback) */
  z.object({ op: z.literal("ack"), ids: z.array(z.string()).max(50) }),
  /** sources without their own module (scripts, HA rest_command) may post a card with the shared token */
  z.object({ op: z.literal("create"), card: notifyInputSchema }),
]);

export async function POST(req: NextRequest) {
  const who = await notifyActor(req);
  if (!who) return new NextResponse("forbidden", { status: 403 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ ok: false, error: p.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  switch (p.data.op) {
    case "read":
      await markRead(p.data.ids);
      return NextResponse.json({ ok: true });
    case "dismiss":
      return NextResponse.json({ ok: true, card: await dismiss(p.data.id, who.by, "dismiss") });
    case "dismissAll": {
      for (const c of await listCards()) if (!c.sticky) await dismiss(c.id, who.by, "dismiss");
      return NextResponse.json({ ok: true });
    }
    case "ack":
      for (const id of p.data.ids) await ack(id, who.deviceId ?? who.by);
      return NextResponse.json({ ok: true });
    case "create": {
      if (who.deviceId === null) return new NextResponse("forbidden", { status: 403 });
      const card = await notify(p.data.card);
      return NextResponse.json({ ok: true, card });
    }
  }
}
