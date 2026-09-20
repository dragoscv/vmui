// Shared between the /home view manager (client) and the settings schema.
// The Python renderer mirrors these ids in turzx/views.py and turzx/skins.py.
// Human text (labels, descriptions, hints, placeholders) lives in
// messages/turzx/{en,ro}.json under views.<id>, skins.<id>, sources.<id> and
// options.<view>.<key>; this file holds only ids, defaults and constraints.

export const TURZX_VIEW_IDS = [
  "clock",
  "weather",
  "home",
  "ambilight",
  "pc",
  "pi",
  "activity",
  "media",
  "lists",
  "fx",
  "crypto",
  "photo",
  "fleet",
  "climate",
  "calendar",
  "pomodoro",
  "network",
  "countdown",
  "quote",
  "ambient",
  "copilot",
  "focus",
  "anniversaries",
  "energy",
  "health",
  "nutrition",
] as const;
export type TurzxViewId = (typeof TURZX_VIEW_IDS)[number];

export const TURZX_SKINS = ["minimal", "glass", "neon", "editorial", "terminal", "paper"] as const;
export type TurzxSkin = (typeof TURZX_SKINS)[number];

export const TURZX_BG_SOURCES = ["folder", "apod", "met", "artic", "commons"] as const;
export type TurzxBgSource = (typeof TURZX_BG_SOURCES)[number];

export type OptionField =
  | { key: string; type: "text" }
  | { key: string; type: "number"; min: number; max: number; step?: number }
  | { key: string; type: "toggle"; default?: boolean }
  | { key: string; type: "select"; choices: string[] }
  | { key: string; type: "list" };

export interface ViewMeta {
  id: TurzxViewId;
  defaultDwell: number;
  /** Skins that make sense for this view; first is the default. */
  skins: TurzxSkin[];
  options: OptionField[];
}

export const TURZX_VIEW_META: Record<TurzxViewId, ViewMeta> = {
  clock: { id: "clock", defaultDwell: 15, skins: ["minimal", "editorial", "glass", "neon", "terminal", "paper"], options: [{ key: "seconds", type: "toggle", default: true }] },
  weather: { id: "weather", defaultDwell: 12, skins: ["minimal", "glass", "editorial", "neon", "paper", "terminal"], options: [] },
  home: { id: "home", defaultDwell: 10, skins: ["minimal", "glass", "neon", "terminal", "paper", "editorial"], options: [] },
  ambilight: { id: "ambilight", defaultDwell: 8, skins: ["minimal", "neon", "glass", "terminal", "paper", "editorial"], options: [] },
  pc: { id: "pc", defaultDwell: 10, skins: ["minimal", "neon", "terminal", "glass", "editorial", "paper"], options: [{ key: "hostname", type: "text" }, { key: "disks", type: "text" }] },
  pi: { id: "pi", defaultDwell: 10, skins: ["minimal", "neon", "terminal", "glass", "editorial", "paper"], options: [{ key: "hostname", type: "text" }] },
  activity: { id: "activity", defaultDwell: 10, skins: ["minimal", "glass", "terminal", "paper", "neon", "editorial"], options: [{ key: "max", type: "number", min: 3, max: 6 }] },
  media: { id: "media", defaultDwell: 10, skins: ["minimal", "glass", "neon", "editorial", "paper", "terminal"], options: [{ key: "skipIdle", type: "toggle" }, { key: "lyrics", type: "toggle", default: true }] },
  lists: { id: "lists", defaultDwell: 10, skins: ["minimal", "paper", "glass", "terminal", "neon", "editorial"], options: [] },
  fx: { id: "fx", defaultDwell: 10, skins: ["editorial", "minimal", "glass", "paper", "terminal", "neon"], options: [{ key: "currencies", type: "list" }, { key: "watchAmount", type: "text" }] },
  crypto: { id: "crypto", defaultDwell: 10, skins: ["neon", "minimal", "editorial", "glass", "terminal", "paper"], options: [{ key: "coins", type: "list" }, { key: "vs", type: "select", choices: ["usd", "eur", "ron"] }, { key: "holdings", type: "list" }] },
  photo: { id: "photo", defaultDwell: 20, skins: ["glass", "minimal", "editorial", "paper", "neon", "terminal"], options: [{ key: "caption", type: "toggle", default: true }, { key: "kenBurns", type: "toggle", default: true }] },
  fleet: { id: "fleet", defaultDwell: 10, skins: ["terminal", "minimal", "glass", "neon", "editorial", "paper"], options: [] },
  climate: { id: "climate", defaultDwell: 12, skins: ["minimal", "glass", "paper", "neon", "terminal", "editorial"], options: [] },
  calendar: { id: "calendar", defaultDwell: 12, skins: ["paper", "minimal", "glass", "editorial", "neon", "terminal"], options: [{ key: "entities", type: "list" }] },
  pomodoro: { id: "pomodoro", defaultDwell: 15, skins: ["editorial", "minimal", "neon", "glass", "terminal", "paper"], options: [{ key: "workMin", type: "number", min: 5, max: 90 }, { key: "breakMin", type: "number", min: 1, max: 30 }] },
  network: { id: "network", defaultDwell: 10, skins: ["terminal", "neon", "minimal", "glass", "editorial", "paper"], options: [{ key: "pingHost", type: "text" }] },
  countdown: { id: "countdown", defaultDwell: 10, skins: ["editorial", "minimal", "glass", "paper", "neon", "terminal"], options: [{ key: "events", type: "list" }] },
  quote: { id: "quote", defaultDwell: 15, skins: ["paper", "editorial", "glass", "minimal", "neon", "terminal"], options: [{ key: "lang", type: "select", choices: ["ro", "en"] }] },
  ambient: { id: "ambient", defaultDwell: 60, skins: ["glass", "minimal", "editorial", "neon", "paper", "terminal"], options: [{ key: "nightOnly", type: "toggle", default: true }] },
  copilot: { id: "copilot", defaultDwell: 12, skins: ["terminal", "minimal", "glass", "neon", "editorial", "paper"], options: [{ key: "activeMin", type: "number", min: 5, max: 240 }] },
  focus: { id: "focus", defaultDwell: 10, skins: ["minimal", "editorial", "glass", "neon", "terminal", "paper"], options: [{ key: "idleMin", type: "number", min: 1, max: 30 }] },
  anniversaries: { id: "anniversaries", defaultDwell: 10, skins: ["paper", "editorial", "minimal", "glass", "neon", "terminal"], options: [{ key: "people", type: "list" }] },
  nutrition: { id: "nutrition", defaultDwell: 12, skins: ["minimal", "neon", "glass", "terminal", "editorial", "paper"], options: [] },
  health: { id: "health", defaultDwell: 12, skins: ["minimal", "neon", "glass", "terminal", "editorial", "paper"], options: [{ key: "stepsGoal", type: "number", min: 1000, max: 30000, step: 500 }, { key: "sleepGoalH", type: "number", min: 4, max: 12, step: 0.5 }, { key: "device", type: "text" }, { key: "heightCm", type: "number", min: 100, max: 230, step: 1 }, { key: "birthDate", type: "text" }, { key: "sex", type: "text" }] },
  energy: { id: "energy", defaultDwell: 10, skins: ["minimal", "neon", "glass", "terminal", "editorial", "paper"], options: [{ key: "pricePerKwh", type: "number", min: 0, max: 5, step: 0.01 }, { key: "entities", type: "list" }] },
};

/** Android packages the notification overlay knows an icon colour for. */
export const NOTIFY_APPS: Array<{ pkg: string; label: string; color: string }> = [
  { pkg: "com.whatsapp", label: "WhatsApp", color: "#25d366" },
  { pkg: "com.instagram.android", label: "Instagram", color: "#e1306c" },
  { pkg: "com.samsung.android.messaging", label: "Messages", color: "#7850ff" },
  { pkg: "com.google.android.apps.messaging", label: "Google Messages", color: "#1a73e8" },
  { pkg: "org.telegram.messenger", label: "Telegram", color: "#229ed9" },
  { pkg: "com.facebook.orca", label: "Messenger", color: "#0084ff" },
  { pkg: "org.thoughtcrime.securesms", label: "Signal", color: "#3a76f0" },
  { pkg: "com.google.android.gm", label: "Gmail", color: "#ea4335" },
  { pkg: "com.discord", label: "Discord", color: "#5865f2" },
  { pkg: "com.Slack", label: "Slack", color: "#4a154b" },
  { pkg: "com.samsung.android.dialer", label: "Telefon", color: "#0078ff" },
  { pkg: "io.homeassistant.companion.android", label: "Home Assistant", color: "#03a9f4" },
];


