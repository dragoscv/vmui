import { copilotEventSchema, currentSignal, inQuietHours, loadCopilotSignals, setSignal, type CopilotEvent } from "@/lib/copilot/signals";
import { stripFx } from "@/lib/copilot/strip-fx";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { pushActivity } from "@/lib/esp/activity";
import { espAuthorized } from "@/lib/esp/auth";
import { listNodes, showMessage } from "@/lib/esp/gallery";
import { ambilightStatus } from "@/lib/home/ambilight-status";
import { ha } from "@/lib/home/ha-client";
import { agentSessions } from "@/lib/turzx/feeds";
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
const PHONE_TITLE: Record<CopilotEvent, string> = { ask: "Copilot așteaptă răspunsul tău", done: "Copilot a terminat tura", blocked: "Comandă blocată de guard", failed: "Build / test eșuat" };
const PHONE_ICON: Record<CopilotEvent, string> = { ask: "mdi:chat-question", done: "mdi:check-decagram", blocked: "mdi:shield-alert", failed: "mdi:alert-octagon" };

/** One phone notification per session: same `tag` so a later event replaces
 *  the earlier card instead of stacking, and the cancel path clears it. */
function phoneTag(session: string) {
  return `copilot-${session || "any"}`;
}

async function phonePush(service: string, event: CopilotEvent, p: { color: string }, text: string, session: string, source: string, project: string, chat: string) {
  const subtitle = [project, chat].filter(Boolean).join(" · ");
  const message = text || (event === "ask" ? "Deschide VS Code și răspunde la întrebare." : event === "done" ? "Poți verifica rezultatul." : source);
  await ha.callService("notify", service, {
    title: PHONE_TITLE[event],
    message,
    data: {
      tag: phoneTag(session),
      group: "copilot",
      channel: event === "ask" ? "Copilot — așteaptă" : "Copilot",
      importance: event === "ask" ? "high" : "default",
      color: p.color,
      notification_icon: PHONE_ICON[event],
      subtitle: subtitle || source,
      // an `ask` stays until answered (sticky, cleared by tag on the next tool call);
      // `persistent` is deliberately NOT set — it blocks clear_notification.
      sticky: event === "ask",
      timeout: event === "ask" ? 0 : 600,
      clickAction: "app://com.microsoft.launcher",
      ttl: 0,
      priority: "high",
    },
  });
}

async function phoneClear(service: string, session: string) {
  await ha.callService("notify", service, { message: "clear_notification", data: { tag: phoneTag(session) } });
}

/** One silent, low-importance card that always shows who is working: one
 *  line per active session (repo · turns today · last request). Re-posted
 *  with the same tag so it updates in place; cleared when nobody is active. */
async function phoneAgentsSummary(service: string) {
  const a = await agentSessions(30);
  if (!a) return;
  if (a.active.length === 0) {
    await ha.callService("notify", service, { message: "clear_notification", data: { tag: "copilot-agents" } });
    return;
  }
  const lines = a.active.slice(0, 6).map((s) => `• ${s.repo}${s.profile !== "default" ? ` (${s.profile})` : ""} · ${s.turnsToday} ture${s.lastUser ? ` — ${s.lastUser.slice(0, 60)}` : ""}`);
  await ha.callService("notify", service, {
    title: `${a.active.length} ${a.active.length === 1 ? "agent lucrează" : "agenți lucrează"} · ${a.turnsToday} ture azi`,
    message: lines.join("\n"),
    data: {
      tag: "copilot-agents",
      group: "copilot",
      channel: "Copilot — agenți",
      importance: "low",
      color: "#6366f1",
      notification_icon: "mdi:robot",
      subtitle: `${a.sessionsToday} sesiuni azi`,
      sticky: true,
      timeout: 3600,
      ttl: 0,
    },
  });
}

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
    if (s.patterns.ask.strip) void stripFx("clear");
    if (s.patterns.ask.phone && s.phoneNotify) phoneClear(s.phoneNotify, cur.session).catch(() => undefined);
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
  const { event, text, session, source, project, chat } = parsed.data;
  const s = await loadCopilotSignals();
  const p = s.patterns[event];
  const now = Date.now();
  setSignal({ id: `${now}|${event}|${session}`, at: now, event, text, source, session, project, chat, active: event === "ask" });
  const where = [project, chat].filter(Boolean).join(" · ");
  const out: Record<string, unknown> = { event, light: false, strip: false, turzx: p.turzx, esp: false };
  if (!s.enabled || !p.enabled) return NextResponse.json({ ...out, skipped: "disabled" });

  const quiet = inQuietHours(s);
  // The strip sits behind the monitor and is already lit in a film, so it is
  // not muted by movie mode; only quiet hours silence it.
  if (p.strip && !quiet) out.strip = await stripFx(event, p.color);
  let movie = false;
  if (s.muteInMovie && p.light) {
    try {
      const h = (await ha.states()).find((x) => x.entity_id === "light.hyperhdr");
      movie = ambilightStatus(h) === "movie";
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
    for (const n of listNodes()) showMessage(n.name, TITLE[event], text || where || source, event === "ask" ? 10 : 8);
    pushActivity({ at: now, kind: "other", text: `${TITLE[event]}${where ? ` [${where.slice(0, 40)}]` : ""}${text ? `: ${text.slice(0, 40)}` : ""}` });
    out.esp = true;
  }
  if (p.phone && s.phoneNotify && !quiet) {
    try {
      await phonePush(s.phoneNotify, event, p, text, session, source, project, chat);
      out.phone = true;
    } catch (e) {
      out.phoneError = e instanceof Error ? e.message : String(e);
    }
  }
  if (s.phoneNotify) phoneAgentsSummary(s.phoneNotify).catch(() => undefined);
  await db.insert(auditLog).values({ accountId: "home", action: `copilot.${event}`, target: project || source, status: "ok", message: [chat, text].filter(Boolean).join(" — ").slice(0, 200) });
  return NextResponse.json({ ...out, quiet, movie });
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
