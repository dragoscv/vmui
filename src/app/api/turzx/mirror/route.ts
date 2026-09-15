import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { espAuthorized } from "@/lib/esp/auth";

export const dynamic = "force-dynamic";

// The renderer (turzx/turzx.py) writes what is actually on the panel to this
// file once a second. Serving it gives /home a live mirror of the desk screen.
const MIRROR = resolve(process.cwd(), ".copilot-tmp", "turzx", "mirror.png");

// Two callers: the /home page (session cookie) and tooling with the shared
// token (?k=). Either is enough.
export async function GET(req: Request) {
  if (!espAuthorized(req)) {
    try {
      await requireRole("viewer");
    } catch {
      return new NextResponse("unauthorized", { status: 401 });
    }
  }
  try {
    const buf = await readFile(MIRROR);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch {
    return new NextResponse("no mirror yet", { status: 404 });
  }
}
