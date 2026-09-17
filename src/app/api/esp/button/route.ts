import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { pushActivity } from "@/lib/esp/activity";
import { espAuthorized } from "@/lib/esp/auth";
import { currentView, nextView, showMessage, togglePause } from "@/lib/esp/gallery";
import { ambilightStatus } from "@/lib/home/ambilight-status";
import { ha } from "@/lib/home/ha-client";
import { drinkGlass, undoGlass } from "@/lib/nutrition/water-actions";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Q = z.object({
  node: z.string().regex(/^[a-z0-9-]{1,32}$/),
  click: z.enum(["single", "double", "long"]),
  /** Which physical button: the BOOT button (default) or the case power switch on GPIO13. */
  btn: z.enum(["boot", "water"]).default("boot"),
});

// POST /api/esp/button?node=…&click=single|double|long&k=…
//   single → next view        double → pause/resume gallery
//   long   → toggle ambilight movie mode (via HA scripts already installed)
// &btn=water (case switch on GPIO13): single → +250 ml, double → +100 ml (a
//   sip, not a whole glass), long → undo last entry.
//   Reply carries `led` so the firmware can blink the switch LED 1×/2×.
export async function POST(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  const p = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return NextResponse.json({ ok: false, error: "bad query" }, { status: 400 });
  const { node, click, btn } = p.data;
  let result = "";
  try {
    if (btn === "water") {
      const r = click === "long" ? await undoGlass("esp-button") : await drinkGlass(click === "double" ? 100 : 250, "esp-button");
      result = `${r.action} ${r.ml} ml -> ${r.water.ml}/${r.water.targetMl}`;
      await db.insert(auditLog).values({ accountId: "home", action: "esp.button", target: node, status: "ok", message: `water ${click} -> ${result}` });
      return NextResponse.json({ ok: true, result, led: r.action === "add" ? 1 : r.action === "undo" ? 2 : 3, ml: r.water.ml, target: r.water.targetMl, underPace: r.water.underPace });
    }
    if (click === "single") result = `view ${nextView(node)}`;
    else if (click === "double") result = togglePause(node) ? "paused" : "resumed";
    else {
      const h = await ha.state("light.hyperhdr").catch(() => null);
      const turningOn = ambilightStatus(h) !== "movie";
      await ha.runScript(turningOn ? "movie_mode_on" : "movie_mode_off");
      showMessage(node, "Ambilight", turningOn ? "Movie mode pornit" : "Ambilight oprit", 3);
      result = turningOn ? "movie on" : "movie off";
      pushActivity({ at: Date.now(), kind: "scene", text: `buton ESP: ${result}` });
    }
    await db.insert(auditLog).values({ accountId: "home", action: "esp.button", target: node, status: "ok", message: `${click} -> ${result}` });
    return NextResponse.json({ ok: true, result, view: currentView(node) });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.insert(auditLog).values({ accountId: "home", action: "esp.button", target: node, status: "error", message: error });
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
