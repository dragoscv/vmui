import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { ensureActivityFeed, recentActivity } from "@/lib/esp/activity";
import { espAuthorized } from "@/lib/esp/auth";
import { ambilightSettings } from "@/lib/home/ambilight-settings";
import { haConfig } from "@/lib/home/credentials";
import { ha, type HaState } from "@/lib/home/ha-client";
import { loadTurzxSettings } from "@/lib/turzx/settings";
import { desc } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/turzx/state?k=<ESP_DISPLAY_TOKEN>
// Everything the desk-screen renderer (turzx/turzx.py) needs, in one poll.
// It runs on this PC, so PC metrics (CPU/GPU/RAM) are read locally by the
// renderer, not here. Must never throw: each block degrades to null.

const pick = (m: Map<string, HaState>, id: string) => {
  const s = m.get(id);
  return s ? { state: s.state, attributes: s.attributes } : null;
};

export async function GET(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  ensureActivityFeed();
  let states = new Map<string, HaState>();
  try {
    states = new Map((await ha.states()).map((s) => [s.entity_id, s]));
  } catch {
    // HA down -> home/weather blocks null, renderer shows offline badge
  }
  const settings = await loadTurzxSettings();
  const amb = await ambilightSettings();
  const lights = [...states.values()].filter((s) => s.entity_id.startsWith("light."));
  const media = [...states.values()].filter((s) => s.entity_id.startsWith("media_player.") && (s.state === "playing" || s.state === "paused"));
  const actions = await db.select({ action: auditLog.action, target: auditLog.target, at: auditLog.createdAt }).from(auditLog).orderBy(desc(auditLog.createdAt)).limit(6);
  let shopping: string[] = [];
  try {
    const r = (await ha.callService("todo", "get_items", { entity_id: "todo.shopping_list", status: "needs_action" })) as unknown as Record<string, { items?: Array<{ summary: string }> }>;
    shopping = (r["todo.shopping_list"]?.items ?? []).map((i) => i.summary);
  } catch {
    // todo list optional
  }
  return NextResponse.json(
    {
      now: Date.now(),
      haOnline: states.size > 0,
      haUrl: haConfig()?.url ?? null,
      settings,
      weather: pick(states, "weather.forecast_home"),
      sun: pick(states, "sun.sun"),
      inside: { temp: pick(states, "sensor.temperature_and_humidity_sensor_temperature"), hum: pick(states, "sensor.temperature_and_humidity_sensor_humidity") },
      home: {
        door: pick(states, "binary_sensor.main_door_door"),
        presence: pick(states, "binary_sensor.human_presence_sensor_occupancy"),
        acBedroom: pick(states, "climate.bedroom_ac"),
        acLiving: pick(states, "climate.living_room_ac_mami"),
        person: pick(states, "person.dragos"),
        lightsOn: lights.filter((l) => l.state === "on").length,
        lightsTotal: lights.length,
      },
      ambilight: {
        hyper: pick(states, "light.hyperhdr"),
        strip: pick(states, "light.led_argb"),
        bar: pick(states, "light.desk_light_bar"),
        wallHex: amb.wallHex,
        wallStrength: amb.wallStrength,
      },
      media: media.map((m) => ({ id: m.entity_id, state: m.state, title: m.attributes.media_title ?? null, artist: m.attributes.media_artist ?? null, app: m.attributes.app_name ?? null, art: m.attributes.entity_picture ?? null, position: m.attributes.media_position ?? null, duration: m.attributes.media_duration ?? null, positionAt: m.attributes.media_position_updated_at ?? null })),
      activity: recentActivity(8),
      actions: actions.map((a) => ({ action: a.action.replace(/^home\./, ""), target: (a.target ?? "").split(".").pop() ?? "", at: a.at ? new Date(a.at).getTime() : null })),
      shopping,
      esp: { rssi: pick(states, "sensor.office_bluetooth_proxy_1_wifi_signal"), heap: pick(states, "sensor.office_bluetooth_proxy_1_heap_free"), uptime: pick(states, "sensor.office_bluetooth_proxy_1_uptime") },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
