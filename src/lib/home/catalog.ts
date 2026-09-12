/**
 * The smart-home inventory as it exists in Home Assistant on 2026-09-12.
 * Shared by server and client (no secrets here). Positions are defaults for
 * the floor plan; the user's own placements live in the `home_layout` table
 * and override these.
 *
 * Coordinates are percentages of the room box (0..100) so the plan scales
 * with the viewport.
 */

export type RoomId = "bedroom" | "living_room" | "kitchen" | "office";

export type DeviceKind =
  | "light"
  | "strip"
  | "projector"
  | "ac"
  | "tv"
  | "display"
  | "monitor"
  | "sensor"
  | "presence"
  | "door"
  | "pc"
  | "proxy";

export type CatalogDevice = {
  /** Stable id used as the layout key. */
  id: string;
  name: string;
  kind: DeviceKind;
  /** Primary controllable entity, if any. */
  entity?: string;
  /** Extra entities shown on the detail sheet (sensors, selects, switches). */
  entities?: string[];
  room: RoomId;
  x: number;
  y: number;
  /** For lights: what part of the screen HyperHDR maps onto it. */
  ambilight?: "top" | "left" | "right" | "full" | "pc";
  /** HA advertises colour modes the firmware rejects (Tuya work_mode enum lacks `colour`). */
  whiteOnly?: boolean;
  /** How the device joined HA — shown as a small caption. */
  via: string;
  notes?: string;
};

export const ROOMS: Array<{ id: RoomId; name: string; x: number; y: number; w: number; h: number }> = [
  { id: "bedroom", name: "Bedroom", x: 2, y: 2, w: 46, h: 56 },
  { id: "living_room", name: "Living Room", x: 52, y: 2, w: 46, h: 56 },
  { id: "kitchen", name: "Kitchen", x: 52, y: 62, w: 46, h: 36 },
  { id: "office", name: "Office", x: 2, y: 62, w: 46, h: 36 },
];

export const DEVICES: CatalogDevice[] = [
  // --- Bedroom: the movie setup lives here ---
  { id: "pc", name: "Gaming PC", kind: "pc", room: "bedroom", x: 22, y: 78, ambilight: "pc", via: "OpenRGB SDK",
    notes: "Under the desk. Case strips + GPU + board glow follow the screen." },
  { id: "monitor", name: "Odyssey OLED G8 34\"", kind: "monitor", room: "bedroom", x: 22, y: 55, via: "Samsung SmartThings TV",
    entity: "media_player.34_odyssey_oled_g8_ls34dg850suxdu", entities: ["remote.34_odyssey_oled_g8_ls34dg850suxdu"],
    notes: "HyperHDR captures this display (DX11, HDR tone-mapped, 60 fps)." },
  { id: "dxlight", name: "DX Light strip (65 LEDs)", kind: "strip", room: "bedroom", x: 22, y: 44, ambilight: "full", via: "USB HID → HyperHDR",
    notes: "Behind the monitor. Right 17 · top 31 · left 17, driven per-LED at ~59 fps." },
  { id: "desk_bar", name: "Desk Light Bar", kind: "light", entity: "light.desk_light_bar", room: "bedroom", x: 22, y: 30, ambilight: "top", via: "Tuya", whiteOnly: true },
  { id: "led_argb", name: "LED ARGB strip (MELK)", kind: "strip", entity: "light.led_argb", room: "bedroom", x: 8, y: 20, ambilight: "full", via: "Bluetooth proxy · elkbledom",
    entities: ["switch.mic_enable_led_argb", "select.mic_effect_led_argb", "select.brightness_mode_led_argb"],
    notes: "One colour for the whole strip (controller limit) — WLED upgrade documented." },
  { id: "star", name: "Star Projector", kind: "projector", entity: "light.star_projector", room: "bedroom", x: 40, y: 12, via: "Tuya" },
  { id: "ac_bedroom", name: "AC", kind: "ac", entity: "climate.bedroom_ac", room: "bedroom", x: 40, y: 40, via: "ConnectLife (Hisense)",
    entities: ["switch.bedroom_ac_eco", "switch.bedroom_ac_super", "switch.bedroom_ac_purifier", "switch.bedroom_ac_fresh_air", "switch.bedroom_ac_vertical_swing", "switch.bedroom_ac_horizontal_swing", "select.bedroom_ac_sleep_mode", "sensor.bedroom_ac_daily_energy"] },
  { id: "display_bedroom", name: "Bedroom Smart Display", kind: "display", entity: "media_player.bedroom_smart_display", room: "bedroom", x: 8, y: 88, via: "Google Cast" },
  { id: "temp", name: "Temperature & humidity", kind: "sensor", room: "bedroom", x: 40, y: 88, via: "Tuya",
    entity: "sensor.temperature_and_humidity_sensor_temperature",
    entities: ["sensor.temperature_and_humidity_sensor_humidity", "sensor.temperature_and_humidity_sensor_battery"] },
  { id: "presence", name: "Presence (WENZI-II)", kind: "presence", entity: "binary_sensor.human_presence_sensor_occupancy", room: "bedroom", x: 8, y: 50, via: "Tuya mmWave" },

  // --- Living room ---
  { id: "ac_living", name: "AC Mami", kind: "ac", entity: "climate.living_room_ac_mami", room: "living_room", x: 80, y: 15, via: "ConnectLife (Hisense)",
    entities: ["switch.living_room_ac_mami_eco", "switch.living_room_ac_mami_super", "switch.living_room_ac_mami_purifier", "switch.living_room_ac_mami_fresh_air", "switch.living_room_ac_mami_vertical_swing", "select.living_room_ac_mami_sleep_mode", "sensor.living_room_ac_mami_daily_energy"] },
  { id: "tv_living", name: "Sufragerie TV", kind: "tv", entity: "media_player.sufragerie", room: "living_room", x: 50, y: 50, via: "Google Cast" },
  { id: "door", name: "Main Door", kind: "door", entity: "binary_sensor.main_door_door", room: "living_room", x: 92, y: 85, via: "Tuya" },

  // --- Kitchen ---
  { id: "tv_kitchen", name: "Kitchen TV", kind: "tv", entity: "media_player.kitchen_tv", room: "kitchen", x: 50, y: 30, via: "Google Cast" },

  // --- Office ---
  { id: "btproxy", name: "Bluetooth Proxy (ESP32)", kind: "proxy", room: "office", x: 50, y: 50, via: "ESPHome",
    entities: ["button.bluetooth_proxy_1_restart"], notes: "Hears the BLE strip for HA; the VM has no radios." },
];

export const AMBILIGHT_MODES = [
  { id: "movie", name: "Movie", script: "movie_mode_on", description: "Screen drives every light. Star projector off." },
  { id: "music", name: "Music", script: "music_mode", description: "Audio-reactive, Voicemeeter B1." },
  { id: "off", name: "Warm room", script: "movie_mode_off", description: "Grabber off; 3000 K at 60 %." },
] as const;

export const MUSIC_EFFECTS = [
  "Music: stereo for LED strip (MULTI COLOR)",
  "Music: stereo for LED strip (MULTI COLOR FAST)",
  "Music: quatro for LED strip (MULTI COLOR)",
  "Music: pulse waves for LED strip (MULTI COLOR)",
  "Music: fullscreen pulse (MULTI COLOR)",
  "Music: fullscreen pulse (WHITE)",
] as const;

export const AMBIENT_EFFECTS = [
  "Warm mood blobs", "Cold mood blobs", "Full color mood blobs", "Sea waves", "Rainbow swirl", "Plasma", "Candle", "Breath",
] as const;

export const HYPERHDR_INSTANCES = [
  { id: 0, name: "DX Light (monitor)", target: "65-LED strip behind the OLED", fps: 60 },
  { id: 1, name: "PC glow (OpenRGB)", target: "Case strips · GPU · board", fps: 20 },
  { id: 2, name: "Room lights (HA)", target: "Desk Light Bar · MELK strip", fps: 3 },
] as const;

export const NOTIFY_PALETTE: Array<{ app: string; label: string; color: [number, number, number] }> = [
  { app: "com.whatsapp", label: "WhatsApp", color: [37, 211, 102] },
  { app: "com.samsung.android.dialer", label: "Phone", color: [0, 120, 255] },
  { app: "com.samsung.android.messaging", label: "Messages", color: [120, 80, 255] },
  { app: "com.google.android.gm", label: "Gmail", color: [234, 67, 53] },
];
