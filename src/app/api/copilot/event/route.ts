import { copilotEventSchema, currentSignal, inQuietHours, loadCopilotSignals, setSignal, type CopilotEvent } from "@/lib/copilot/signals";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { pushActivity } from "@/lib/esp/activity";
import { espAuthorized } from "@/lib/esp/auth";
import { listNodes, showMessage } from "@/lib/esp/gallery";
import { ha } from "@/lib/home/ha-client";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// POST /api/copilot/event?k=<ESP_DISPLAY_TOKEN>   body: { event, text?, session?, source? }
// DELETE /api/copilot/event?k=…&session=…          cancel an active `ask` (next tool call)
// GET  /api/copilot/event?k=…                       current state (turzx polls via /api/turzx/state)
//
// Fired by ~/.copilot/hooks/copilot-signal.ps1. Each event fans out to the
// room light (HA script), the turzx desk screen (card) and the ESP32 OLED
// (message + activity line). Everything is best-effort: a dead HA must
// never make a hook fail.

const HA_SCRIPT: Record<CopilotEvent, string> = {
  ask: "copilot_ask",
  done: "copilot_done",
  blocked: "copilot_blocked",
  failed: "copilot_failed",
};
const TITLE: Record<CopilotEvent, string> = { ask: "Copilot asteapta", done: "Copilot gata", blocked: "Comanda blocata", failed: "A esuat" };

export async function GET(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  return NextResponse.json({ signal: currentSignal() }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  const cur = currentSignal();
  const session = new URL(req.url).searchParams.get("session") ?? "";
  if (cur?.active && (!session || !cur.session || cur.session === session)) {
    setSignal({ ...cur, active: false });
    const s = await loadCopilotSignals();
    if (s.patterns.ask.light && s.lights.length) {
      try {
        // script.turn_on returns as soon as the run starts; the direct service
        // form waits for completion, and copilot_ask never completes on its own.
        await ha.callService("script", "turn_on", { entity_id: "script.copilot_clear", variables: { lights: s.lights } });
      } catch {
        // HA down: nothing to clear
      }
    }
    return NextResponse.json({ cancelled: true });
  }
  return NextResponse.json({ cancelled: false });
}

export async function POST(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  const parsed = copilotEventSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { event, text, session, source } = parsed.data;
  const s = await loadCopilotSignals();
  const p = s.patterns[event];
  const now = Date.now();
  setSignal({ id: `${now}|${event}|${session}`, at: now, event, text, source, session, active: event === "ask" });
  const out: Record<string, unknown> = { event, light: false, turzx: p.turzx, esp: false };
  if (!s.enabled || !p.enabled) return NextResponse.json({ ...out, skipped: "disabled" });

  const quiet = inQuietHours(s);
  let movie = false;
  if (s.muteInMovie && p.light) {
    try {
      const h = (await ha.states()).find((x) => x.entity_id === "light.hyperhdr");
      movie = h?.state === "on";
    } catch {
      // HA down -> no light anyway
    }
  }
  if (p.light && s.lights.length && !quiet && !movie) {
    try {
      // Snapshot "before" only when no alert is running (the script checks),
      // and wait for it: the direct service form blocks until it completes.
      await ha.callService("script", "copilot_snapshot", { lights: s.lights });
      await ha.callService("script", "turn_on", { entity_id: `script.${HA_SCRIPT[event]}`, variables: { lights: s.lights, color: hexToRgb(p.color) } });
      out.light = true;
    } catch (e) {
      out.lightError = e instanceof Error ? e.message : String(e);
    }
  }
  if (p.esp) {
    for (const n of listNodes()) showMessage(n.name, TITLE[event], text || source, event === "ask" ? 60 : 8);
    pushActivity({ at: now, kind: "other", text: `${TITLE[event]}${text ? `: ${text.slice(0, 40)}` : ""}` });
    out.esp = true;
  }
  await db.insert(auditLog).values({ accountId: "home", action: `copilot.${event}`, target: source, status: "ok", message: text.slice(0, 200) });
  return NextResponse.json({ ...out, quiet, movie });
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
