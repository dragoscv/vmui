import { loadDisplaySettings } from "@/lib/display/settings";
import { espAuthorized } from "@/lib/esp/auth";
import { DEVICES, ROOMS } from "@/lib/home/catalog";
import { haConfig } from "@/lib/home/credentials";
import { ha } from "@/lib/home/ha-client";
import { photoPool } from "@/lib/turzx/feeds";
import { NextResponse, type NextRequest } from "next/server";

// The Hub sits in the bedroom: it only shows what plays in the bedroom
// (its own Cast session, the bedroom TV), never the living-room TV.
const HUB_ROOM = "bedroom";

export const dynamic = "force-dynamic";

// GET /api/display/state?k=…
// One poll for the Nest Hub kiosk: the Turzx aggregate (same feeds, same
// settings-driven fetching) + the Hub's own settings + the device catalog with
// live states for the home screen. Turzx state is fetched over loopback rather
// than duplicating its 200-line aggregator; the cost is ~1 ms in-process.
export async function GET(req: NextRequest) {
  if (!espAuthorized(req)) return new NextResponse("forbidden", { status: 403 });
  const k = new URL(req.url).searchParams.get("k") ?? "";
  const origin = `http://127.0.0.1:${process.env.PORT ?? 3737}`;
  const settings = await loadDisplaySettings();
  const [turzx, states, photos] = await Promise.all([
    fetch(`${origin}/api/turzx/state?k=${encodeURIComponent(k)}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : null)).catch(() => null),
    ha.states().catch(() => []),
    // the Hub's own sources (the Turzx aggregate carries the desk screen's), cached 6 h per source in photoPool
    photoPool(settings.photoSources).catch(() => []),
  ]);
  const roomPlayers = new Set(DEVICES.filter((d) => d.room === HUB_ROOM).flatMap((d) => [d.entity, ...(d.entities ?? [])]).filter((e): e is string => !!e && e.startsWith("media_player.")));
  const media = Array.isArray(turzx?.media) ? (turzx.media as Array<{ id: string }>).filter((m) => roomPlayers.has(m.id)) : [];
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  const want = new Set<string>();
  for (const d of DEVICES) {
    if (d.entity) want.add(d.entity);
    for (const e of d.entities ?? []) want.add(e);
  }
  // the Hub itself shows up as a device; scenes/scripts states are not needed
  want.add("light.hyperhdr");
  const entities: Record<string, { state: string; attributes: Record<string, unknown> }> = {};
  for (const id of want) {
    const s = byId.get(id);
    if (s) entities[id] = { state: s.state, attributes: s.attributes };
  }
  return NextResponse.json(
    {
      ...(turzx ?? {}),
      photos,
      media,
      display: settings,
      rooms: ROOMS,
      devices: DEVICES,
      entities,
      hubIdle: byId.get("input_boolean.nest_hub_idle")?.state === "on" ? true : byId.has("input_boolean.nest_hub_idle") ? false : null,
      haUrl: haConfig()?.url ?? null,
      now: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
