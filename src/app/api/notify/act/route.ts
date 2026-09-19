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
  const r = await runAction(p.data.id, p.data.action, who.by);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
