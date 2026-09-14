import { db } from "@/lib/db";
import { homeLayout } from "@/lib/db/schema";
import { ambilightSettings } from "@/lib/home/ambilight-settings";
import { DEVICES, type CatalogDevice } from "@/lib/home/catalog";
import { ha, type HaState } from "@/lib/home/ha-client";
import "server-only";

export type PlacedDevice = CatalogDevice & { placed: boolean };

export type WallSetting = { wallHex: string; strength: number };

export async function wallSetting(): Promise<WallSetting> {
  const s = await ambilightSettings();
  return { wallHex: s.wallHex, strength: s.wallStrength };
}

export async function listPlacedDevices(): Promise<PlacedDevice[]> {
  const rows = await db.select().from(homeLayout);
  const byId = new Map(rows.map((r) => [r.deviceId, r]));
  return DEVICES.map((d) => {
    const r = byId.get(d.id);
    return r ? { ...d, room: r.room as CatalogDevice["room"], x: r.x, y: r.y, placed: true } : { ...d, placed: false };
  });
}

/** Every HA state the catalog references, keyed by entity_id. Empty map when HA is down. */
export async function loadHomeStates(): Promise<Record<string, HaState>> {
  if (!ha.configured()) return {};
  const wanted = new Set<string>();
  for (const d of DEVICES) {
    if (d.entity) wanted.add(d.entity);
    for (const e of d.entities ?? []) wanted.add(e);
  }
  wanted.add("light.hyperhdr");
  wanted.add("sensor.dragos_s_s25_ultra_last_notification");
  try {
    const all = await ha.states();
    const out: Record<string, HaState> = {};
    for (const s of all) if (wanted.has(s.entity_id)) out[s.entity_id] = s;
    return out;
  } catch {
    return {};
  }
}

export async function homeAvailability(): Promise<{ ok: boolean; url: string | null; error?: string }> {
  if (!ha.configured()) return { ok: false, url: null, error: "HA_URL / HA_TOKEN missing in .private/credentials.env" };
  try {
    await ha.state("light.hyperhdr");
    return { ok: true, url: ha.publicUrl() };
  } catch (e) {
    return { ok: false, url: ha.publicUrl(), error: e instanceof Error ? e.message : String(e) };
  }
}
