import { getCurrentUser } from "@/lib/auth";
import { approveDevice, deviceFromRequest, devicesVersion, listDevices, pendingDevices, rejectDevice, renameDevice, revokeDevice } from "@/lib/devices/pairing";
import { espAuthorized } from "@/lib/esp/auth";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Who may manage devices: a signed-in vmui user (web /home), an already-
// approved device (the "approve from the phone you already have" path), or
// the desktop app on the PC that holds .private/credentials.env (shared token).
async function actor(req: NextRequest): Promise<string | null> {
  const u = await getCurrentUser().catch(() => null);
  if (u) return u.email;
  const d = await deviceFromRequest(req);
  if (d) return `device:${d.name}`;
  return espAuthorized(req) ? "desktop:shared-token" : null;
}

/** GET: everything + pending (with codes) for banners. `?since=N` long-polls up to 25 s for a change. */
export async function GET(req: NextRequest) {
  if (!(await actor(req))) return new NextResponse("forbidden", { status: 403 });
  const since = Number(req.nextUrl.searchParams.get("since") ?? NaN);
  if (Number.isFinite(since)) {
    const until = Date.now() + 25_000;
    while (devicesVersion() === since && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
  }
  const [devices, pending] = await Promise.all([listDevices(), pendingDevices()]);
  return NextResponse.json({ devices, pending, version: devicesVersion() }, { headers: { "Cache-Control": "no-store" } });
}

const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("approve"), id: z.string().length(16), code: z.string().length(4) }),
  z.object({ op: z.literal("reject"), id: z.string().length(16) }),
  z.object({ op: z.literal("revoke"), id: z.string().length(16) }),
  z.object({ op: z.literal("rename"), id: z.string().length(16), name: z.string().min(1).max(64) }),
]);

export async function POST(req: NextRequest) {
  const by = await actor(req);
  if (!by) return new NextResponse("forbidden", { status: 403 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  switch (p.data.op) {
    case "approve": {
      const r = await approveDevice(p.data.id, p.data.code, by);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "reject":
      await rejectDevice(p.data.id, by);
      return NextResponse.json({ ok: true });
    case "revoke":
      await revokeDevice(p.data.id, by);
      return NextResponse.json({ ok: true });
    case "rename":
      await renameDevice(p.data.id, p.data.name);
      return NextResponse.json({ ok: true });
  }
}
