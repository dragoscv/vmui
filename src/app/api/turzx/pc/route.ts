import { espAuthorized } from "@/lib/esp/auth";
import { setPcMetrics } from "@/lib/turzx/pc-metrics";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const body = z.record(z.string(), z.unknown()).refine((o) => JSON.stringify(o).length < 16_000, "too large");

// POST /api/turzx/pc?k=…&host=<hostname>   body: the dict turzx.py's pc_metrics() produces on that PC
export async function POST(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  const host = (new URL(req.url).searchParams.get("host") ?? "pc").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) || "pc";
  setPcMetrics(host, p.data);
  return NextResponse.json({ ok: true });
}
