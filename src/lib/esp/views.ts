import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { ha, type HaState } from "@/lib/home/ha-client";
import { desc } from "drizzle-orm";
import "server-only";
import { recentActivity } from "./activity";
import { fit, text, textCentered, textRight, wrap } from "./font";
import { Framebuffer, H, W, YELLOW_ROWS } from "./framebuffer";

// Each view paints a 128x64 frame. The top 16 rows are the yellow band on the
// ideaspark panel, so every view puts its title there and body below.

export type ViewId = "clock" | "weather" | "activity" | "home" | "ambilight" | "system" | "todo" | "notes";

export const VIEW_ORDER: ViewId[] = ["clock", "weather", "activity", "home", "ambilight", "todo", "notes", "system"];

export type ViewContext = {
  states: Map<string, HaState>;
  now: Date;
  node: string;
  paused: boolean;
  ambilightMode: string;
};

function band(fb: Framebuffer, title: string, right?: string): void {
  fb.fill(0, 0, W, YELLOW_ROWS, true);
  text(fb, 2, 4, title, 1, false);
  if (right) textRight(fb, 125, 4, right, 1, false);
}

function hhmm(d: Date): string {
  return d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
}

const DAYS = ["Duminica", "Luni", "Marti", "Miercuri", "Joi", "Vineri", "Sambata"];
const MONTHS = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "nov", "dec"];

function st(ctx: ViewContext, id: string): HaState | undefined {
  return ctx.states.get(id);
}
function num(s: HaState | undefined, digits = 0): string {
  if (!s || s.state === "unavailable" || s.state === "unknown") return "--";
  const n = Number(s.state);
  return Number.isFinite(n) ? n.toFixed(digits) : s.state;
}

// ---------------------------------------------------------------- views

function viewClock(fb: Framebuffer, ctx: ViewContext): void {
  const d = ctx.now;
  const local = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Bucharest" }));
  band(fb, DAYS[local.getDay()]!, `${local.getDate()} ${MONTHS[local.getMonth()]}`);
  textCentered(fb, 22, hhmm(d), 3);
  const temp = st(ctx, "sensor.temperature_and_humidity_sensor_temperature");
  const hum = st(ctx, "sensor.temperature_and_humidity_sensor_humidity");
  const w = st(ctx, "weather.forecast_home");
  const out = w ? `${Math.round(Number(w.attributes.temperature))}*` : "--";
  text(fb, 0, 54, `in ${num(temp, 1)}* ${num(hum)}%`);
  textRight(fb, 127, 54, `afara ${out}`);
}

const WEATHER_RO: Record<string, string> = {
  "clear-night": "senin", sunny: "soare", cloudy: "innorat", partlycloudy: "partial nori", fog: "ceata", hail: "grindina",
  lightning: "furtuna", "lightning-rainy": "furtuna", pouring: "ploaie torentiala", rainy: "ploaie", snowy: "ninsoare",
  "snowy-rainy": "lapovita", windy: "vant", "windy-variant": "vant", exceptional: "extrem",
};

function viewWeather(fb: Framebuffer, ctx: ViewContext): void {
  const w = st(ctx, "weather.forecast_home");
  band(fb, "Vremea", "Home");
  if (!w) return void textCentered(fb, 34, "fara date meteo");
  const a = w.attributes as Record<string, number | string>;
  text(fb, 2, 20, `${Math.round(Number(a.temperature))}*`, 3);
  text(fb, 62, 20, fit(WEATHER_RO[w.state] ?? w.state, 64));
  text(fb, 62, 30, `umid ${a.humidity ?? "--"}%`);
  text(fb, 62, 40, `vant ${Math.round(Number(a.wind_speed ?? 0))} km/h`);
  text(fb, 2, 54, `pres ${Math.round(Number(a.pressure ?? 0))} hPa`);
  const sun = st(ctx, "sun.sun");
  if (sun) {
    const next = sun.state === "above_horizon" ? sun.attributes.next_setting : sun.attributes.next_rising;
    if (typeof next === "string") textRight(fb, 125, 54, `${sun.state === "above_horizon" ? "apus" : "rasarit"} ${hhmm(new Date(next))}`);
  }
}

function viewActivity(fb: Framebuffer, _ctx: ViewContext): void {
  const items = recentActivity(6);
  band(fb, "Activitate", `${items.length}`);
  if (!items.length) return void textCentered(fb, 34, "nimic recent");
  let y = 18;
  for (const it of items.slice(0, 5)) {
    const t = hhmm(new Date(it.at));
    text(fb, 0, y, t);
    text(fb, 34, y, fit(it.text, 94));
    y += 9;
  }
}

function viewHome(fb: Framebuffer, ctx: ViewContext): void {
  const lightsOn = [...ctx.states.values()].filter((s) => s.entity_id.startsWith("light.") && s.state === "on").length;
  band(fb, "Acasa", `${lightsOn} lumini`);
  const door = st(ctx, "binary_sensor.main_door_door");
  const pres = st(ctx, "binary_sensor.human_presence_sensor_occupancy");
  const ac = st(ctx, "climate.bedroom_ac");
  const ac2 = st(ctx, "climate.living_room_ac_mami");
  const person = st(ctx, "person.dragos");
  text(fb, 0, 18, `usa: ${door ? (door.state === "on" ? "DESCHISA" : "inchisa") : "--"}`);
  text(fb, 0, 27, `dormitor: ${pres ? (pres.state === "on" ? "cineva" : "gol") : "--"}`);
  text(fb, 0, 36, `AC dorm: ${ac ? (ac.state === "off" ? "oprit" : `${ac.state} ${ac.attributes.temperature ?? ""}*`) : "--"}`);
  text(fb, 0, 45, `AC living: ${ac2 ? (ac2.state === "off" ? "oprit" : `${ac2.state} ${ac2.attributes.temperature ?? ""}*`) : "--"}`);
  text(fb, 0, 54, `Dragos: ${person ? (person.state === "home" ? "acasa" : "plecat") : "--"}`);
}

function viewAmbilight(fb: Framebuffer, ctx: ViewContext): void {
  band(fb, "Ambilight", ctx.ambilightMode);
  const bar = st(ctx, "light.desk_light_bar");
  const strip = st(ctx, "light.led_argb");
  const hyper = st(ctx, "light.hyperhdr");
  text(fb, 0, 18, `HyperHDR: ${hyper ? hyper.state : "--"}`);
  text(fb, 0, 27, `bara birou: ${bar ? (bar.state === "on" ? `${Math.round(Number(bar.attributes.brightness ?? 0) / 2.55)}%` : "stinsa") : "--"}`);
  text(fb, 0, 36, `banda MELK: ${strip ? (strip.state === "on" ? "on" : strip.state) : "--"}`);
  if (strip?.state === "on" && Array.isArray(strip.attributes.rgb_color)) {
    const [r, g, b] = strip.attributes.rgb_color as number[];
    text(fb, 0, 45, `culoare ${r},${g},${b}`);
  }
  text(fb, 0, 54, "lung=movie/off  dublu=pauza");
}

async function viewTodo(fb: Framebuffer, _ctx: ViewContext): Promise<void> {
  band(fb, "Cumparaturi");
  try {
    const r = (await ha.callService("todo", "get_items", { entity_id: "todo.shopping_list", status: "needs_action" })) as unknown as Record<string, { items?: Array<{ summary: string }> }>;
    const items = r["todo.shopping_list"]?.items ?? [];
    if (!items.length) return void textCentered(fb, 34, "lista goala");
    let y = 18;
    for (const it of items.slice(0, 5)) {
      text(fb, 0, y, `- ${fit(it.summary, 118)}`);
      y += 9;
    }
    if (items.length > 5) textRight(fb, 125, 54, `+${items.length - 5}`);
  } catch {
    textCentered(fb, 34, "todo indisponibil");
  }
}

async function viewNotes(fb: Framebuffer, _ctx: ViewContext): Promise<void> {
  // Notes = the last things the operator did in vmui (audit log), which
  // doubles as a "what did I change" reminder on the desk.
  band(fb, "Ultimele actiuni", "vmui");
  const rows = await db.select({ action: auditLog.action, target: auditLog.target, createdAt: auditLog.createdAt }).from(auditLog).orderBy(desc(auditLog.createdAt)).limit(5);
  if (!rows.length) return void textCentered(fb, 34, "nimic");
  let y = 18;
  for (const r of rows) {
    const t = r.createdAt ? hhmm(new Date(r.createdAt)) : "";
    text(fb, 0, y, t);
    text(fb, 34, y, fit(`${r.action.replace(/^home\./, "")} ${(r.target ?? "").split(".").pop() ?? ""}`, 94));
    y += 9;
  }
}

function viewSystem(fb: Framebuffer, ctx: ViewContext): void {
  band(fb, "Sistem", ctx.node);
  const upd = [...ctx.states.values()].filter((s) => s.entity_id.startsWith("update.") && s.state === "on").length;
  const unavailable = [...ctx.states.values()].filter((s) => s.state === "unavailable").length;
  const rssi = st(ctx, `sensor.${ctx.node.replace(/-/g, "_")}_wifi_signal`);
  const bat = st(ctx, "sensor.dragos_s_s25_ultra_battery_level");
  text(fb, 0, 18, `HA entitati: ${ctx.states.size}  indisp: ${unavailable}`);
  text(fb, 0, 27, `update-uri: ${upd}`);
  text(fb, 0, 36, `wifi esp: ${rssi ? `${rssi.state} dBm` : "--"}`);
  text(fb, 0, 45, `telefon: ${bat ? `${bat.state}%` : "--"}`);
  text(fb, 0, 54, `mui.dragoscatalin.ro`);
}

export async function renderView(id: ViewId, ctx: ViewContext): Promise<Framebuffer> {
  const fb = new Framebuffer();
  switch (id) {
    case "clock": viewClock(fb, ctx); break;
    case "weather": viewWeather(fb, ctx); break;
    case "activity": viewActivity(fb, ctx); break;
    case "home": viewHome(fb, ctx); break;
    case "ambilight": viewAmbilight(fb, ctx); break;
    case "todo": await viewTodo(fb, ctx); break;
    case "notes": await viewNotes(fb, ctx); break;
    case "system": viewSystem(fb, ctx); break;
  }
  if (ctx.paused) {
    // Tiny pause glyph in the band's right corner (over the title bar).
    fb.fill(118, 3, 3, 9, false);
    fb.fill(123, 3, 3, 9, false);
  }
  // Gallery position dots along the bottom edge.
  const i = VIEW_ORDER.indexOf(id);
  const n = VIEW_ORDER.length;
  const x0 = Math.floor((W - (n * 4 - 2)) / 2);
  for (let k = 0; k < n; k++) fb.fill(x0 + k * 4, H - 1, k === i ? 2 : 1, 1, true);
  return fb;
}

/** Wrap a free-text message into a frame (used by pushed notifications). */
export function renderMessage(title: string, body: string): Framebuffer {
  const fb = new Framebuffer();
  band(fb, title);
  let y = 20;
  for (const line of wrap(body, 126, 4)) {
    text(fb, 1, y, line);
    y += 10;
  }
  return fb;
}
