import { espAuthorized } from "@/lib/esp/auth";
import { homeActorOrOwner, journalUserId } from "@/lib/home/access";
import { nutritionSummary } from "@/lib/nutrition/summary";
import { drinkGlass, undoGlass } from "@/lib/nutrition/water-actions";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

async function scoped(req: NextRequest) {
  const actor = await homeActorOrOwner(req, espAuthorized(req));
  if (!actor) return null;
  const uid = journalUserId(actor);
  const isOwner = actor.role === "owner";
  return { uid, isOwner, scope: uid ? { userId: uid, isOwner } : null };
}

const bodySchema = z.object({
  ml: z.number().int().min(25).max(2000).default(250),
  source: z.string().max(40).default("codai-phone"),
});

// GET  /api/nutrition/water?k=…              today's water + pace flag (ESP polls this for the LED)
// POST /api/nutrition/water?k=…  {ml?,source?} +1 glass (phone: "am băut un pahar")
// DELETE /api/nutrition/water?k=…            undo the newest glass
export async function GET(req: NextRequest) {
  const a = await scoped(req);
  if (!a) return new NextResponse("unauthorized", { status: 401 });
  const w = (await nutritionSummary(a.scope)).water;
  // Terse on purpose: the ESP parses this with ~300 KB of heap.
  return NextResponse.json({ ml: w.ml, target: w.targetMl, glasses: w.glasses, underPace: w.underPace, lastAt: w.lastAt }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const a = await scoped(req);
  if (!a) return new NextResponse("unauthorized", { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const r = await drinkGlass(parsed.data.ml, parsed.data.source, a.uid, a.isOwner);
  return NextResponse.json({ ok: true, action: r.action, ml: r.water.ml, target: r.water.targetMl, glasses: r.water.glasses, underPace: r.water.underPace });
}

export async function DELETE(req: NextRequest) {
  const a = await scoped(req);
  if (!a) return new NextResponse("unauthorized", { status: 401 });
  const r = await undoGlass(new URL(req.url).searchParams.get("source") ?? "codai-phone", a.uid, a.isOwner);
  return NextResponse.json({ ok: true, action: r.action, removedMl: r.ml, ml: r.water.ml, target: r.water.targetMl, glasses: r.water.glasses });
}
