import { espAuthorized } from "@/lib/esp/auth";
import { armAutoOpen, ignoreCall, intercomState, isAutoOpenArmed, onEspEvent, openDoor } from "@/lib/home/intercom";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const espQ = z.object({
  node: z.string().regex(/^[a-z0-9-]{1,32}$/),
  event: z.enum(["ring", "end", "opened"]),
});

// POST /api/esp/intercom?k=…&node=…&event=ring|end|opened   (from the ESP32)
//   ring answers {"open":true} while auto-open is armed, so the ESP runs the
//   talk+open sequence itself without a second round trip.
export async function POST(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  const p = espQ.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return NextResponse.json({ ok: false, error: "bad query" }, { status: 400 });
  const r = await onEspEvent(p.data.event, p.data.node);
  return NextResponse.json({ ok: true, ...r });
}

// GET /api/esp/intercom?k=…            state for the phone / turzx
export async function GET(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  const s = intercomState();
  return NextResponse.json({ ringing: s.ringingSince !== null, ringingSince: s.ringingSince, lastRingAt: s.lastRingAt, lastOpenAt: s.lastOpenAt, autoOpenUntil: s.autoOpenUntil, armed: isAutoOpenArmed(), log: s.log }, { headers: { "Cache-Control": "no-store" } });
}

const cmd = z.object({
  action: z.enum(["open", "ignore", "arm", "disarm"]),
  minutes: z.number().int().min(1).max(240).default(45),
  by: z.string().max(40).default("phone"),
});

// PUT /api/esp/intercom?k=…  body {action: open|ignore|arm|disarm, minutes?, by?}
export async function PUT(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  const p = cmd.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ ok: false, error: p.error.flatten() }, { status: 400 });
  const { action, minutes, by } = p.data;
  if (action === "open") return NextResponse.json(await openDoor(by));
  if (action === "ignore") {
    await ignoreCall(by);
    return NextResponse.json({ ok: true });
  }
  const s = await armAutoOpen(action === "arm" ? minutes : 0, by);
  return NextResponse.json({ ok: true, autoOpenUntil: s.autoOpenUntil });
}
