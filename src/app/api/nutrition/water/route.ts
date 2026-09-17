import { espAuthorized } from "@/lib/esp/auth";
import { nutritionSummary } from "@/lib/nutrition/summary";
import { drinkGlass, undoGlass } from "@/lib/nutrition/water-actions";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ml: z.number().int().min(25).max(2000).default(250),
  source: z.string().max(40).default("codai-phone"),
});

// GET  /api/nutrition/water?k=…              today's water + pace flag (ESP polls this for the LED)
// POST /api/nutrition/water?k=…  {ml?,source?} +1 glass (phone: "am băut un pahar")
// DELETE /api/nutrition/water?k=…            undo the newest glass
export async function GET(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  const w = (await nutritionSummary()).water;
  // Terse on purpose: the ESP parses this with ~300 KB of heap.
  return NextResponse.json({ ml: w.ml, target: w.targetMl, glasses: w.glasses, underPace: w.underPace, lastAt: w.lastAt }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const r = await drinkGlass(parsed.data.ml, parsed.data.source);
  return NextResponse.json({ ok: true, action: r.action, ml: r.water.ml, target: r.water.targetMl, glasses: r.water.glasses, underPace: r.water.underPace });
}

export async function DELETE(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  const r = await undoGlass(new URL(req.url).searchParams.get("source") ?? "codai-phone");
  return NextResponse.json({ ok: true, action: r.action, removedMl: r.ml, ml: r.water.ml, target: r.water.targetMl, glasses: r.water.glasses });
}
