import { notifyActor } from "@/lib/notify/auth";
import { fcmConfigured } from "@/lib/notify/fcm";
import { KIND_META, loadNotifySettings, saveNotifySettings } from "@/lib/notify/settings";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await notifyActor(req))) return new NextResponse("forbidden", { status: 403 });
  return NextResponse.json({ settings: await loadNotifySettings(), meta: KIND_META, fcm: fcmConfigured() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const who = await notifyActor(req);
  if (!who) return new NextResponse("forbidden", { status: 403 });
  try {
    const s = await saveNotifySettings(await req.json());
    return NextResponse.json({ ok: true, settings: s });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "invalid" }, { status: 400 });
  }
}
