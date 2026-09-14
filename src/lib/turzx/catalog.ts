// Shared between the /home view manager (client) and the settings schema.
// The Python renderer mirrors these ids in turzx/views.py and turzx/skins.py.

export const TURZX_VIEW_IDS = [
  "clock",
  "weather",
  "home",
  "ambilight",
  "pc",
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
] as const;
export type TurzxViewId = (typeof TURZX_VIEW_IDS)[number];

export const TURZX_SKINS = ["minimal", "glass", "neon", "editorial", "terminal", "paper"] as const;
export type TurzxSkin = (typeof TURZX_SKINS)[number];

export const TURZX_BG_SOURCES = ["folder", "apod", "met", "artic", "commons"] as const;
export type TurzxBgSource = (typeof TURZX_BG_SOURCES)[number];

export type OptionField =
  | { key: string; label: string; type: "text"; placeholder?: string }
  | { key: string; label: string; type: "number"; min: number; max: number; step?: number }
  | { key: string; label: string; type: "toggle"; default?: boolean }
  | { key: string; label: string; type: "select"; choices: { value: string; label: string }[] }
  | { key: string; label: string; type: "list"; placeholder?: string; hint?: string };

export interface ViewMeta {
  id: TurzxViewId;
  label: string;
  description: string;
  defaultDwell: number;
  /** Skins that make sense for this view; first is the default. */
  skins: TurzxSkin[];
  options: OptionField[];
}

export const TURZX_VIEW_META: Record<TurzxViewId, ViewMeta> = {
  clock: { id: "clock", label: "Ceas", description: "Ora cu cifre care se morfează, data, înăuntru/afară.", defaultDwell: 15, skins: ["minimal", "editorial", "glass", "neon", "terminal", "paper"], options: [{ key: "seconds", label: "Arată secundele", type: "toggle", default: true }] },
  weather: { id: "weather", label: "Vremea", description: "Icon animat, temperatură, vânt, presiune, răsărit/apus.", defaultDwell: 12, skins: ["minimal", "glass", "editorial", "neon", "paper", "terminal"], options: [] },
  home: { id: "home", label: "Acasă", description: "Ușă, prezență, AC-uri, lumini aprinse.", defaultDwell: 10, skins: ["minimal", "glass", "neon", "terminal", "paper", "editorial"], options: [] },
  ambilight: { id: "ambilight", label: "Ambilight", description: "Culoarea live a benzii, perete, HyperHDR.", defaultDwell: 8, skins: ["minimal", "neon", "glass", "terminal", "paper", "editorial"], options: [] },
  pc: { id: "pc", label: "PC", description: "CPU / GPU / RAM cu arce și sparkline.", defaultDwell: 10, skins: ["minimal", "neon", "terminal", "glass", "editorial", "paper"], options: [{ key: "hostname", label: "Nume afișat", type: "text", placeholder: "dragos-pc" }] },
  activity: { id: "activity", label: "Activitate", description: "Ultimele evenimente din casă.", defaultDwell: 10, skins: ["minimal", "glass", "terminal", "paper", "neon", "editorial"], options: [{ key: "max", label: "Evenimente afișate", type: "number", min: 3, max: 6 }] },
  media: { id: "media", label: "Redare", description: "Ce se aude acum, cu copertă și titluri care derulează.", defaultDwell: 10, skins: ["minimal", "glass", "neon", "editorial", "paper", "terminal"], options: [{ key: "skipIdle", label: "Sari peste când nimic nu redă", type: "toggle" }] },
  lists: { id: "lists", label: "Liste", description: "Cumpărături și acțiuni din HA.", defaultDwell: 10, skins: ["minimal", "paper", "glass", "terminal", "neon", "editorial"], options: [] },
  fx: { id: "fx", label: "Curs BNR", description: "EUR/USD/GBP în RON cu tendința pe 30 de zile.", defaultDwell: 10, skins: ["editorial", "minimal", "glass", "paper", "terminal", "neon"], options: [{ key: "currencies", label: "Monede", type: "list", placeholder: "EUR", hint: "coduri ISO, ex. EUR USD GBP CHF" }] },
  crypto: { id: "crypto", label: "Crypto", description: "Prețuri CoinGecko cu variația pe 24 h.", defaultDwell: 10, skins: ["neon", "minimal", "editorial", "glass", "terminal", "paper"], options: [{ key: "coins", label: "Monede", type: "list", placeholder: "bitcoin", hint: "id-uri CoinGecko: bitcoin ethereum solana" }, { key: "vs", label: "În", type: "select", choices: [{ value: "usd", label: "USD" }, { value: "eur", label: "EUR" }, { value: "ron", label: "RON" }] }] },
  photo: { id: "photo", label: "Foto / Artă", description: "O imagine pe tot ecranul, cu titlu și credit.", defaultDwell: 20, skins: ["glass", "minimal", "editorial", "paper", "neon", "terminal"], options: [{ key: "caption", label: "Arată titlul și creditul", type: "toggle", default: true }] },
  fleet: { id: "fleet", label: "Mașini virtuale", description: "VM-urile din vmui: stare, RAM, CPU.", defaultDwell: 10, skins: ["terminal", "minimal", "glass", "neon", "editorial", "paper"], options: [] },
  climate: { id: "climate", label: "Climat 24 h", description: "Grafic temperatură și umiditate pe ultimele 24 h.", defaultDwell: 12, skins: ["minimal", "glass", "paper", "neon", "terminal", "editorial"], options: [] },
  calendar: { id: "calendar", label: "Calendar", description: "Următoarele evenimente din calendarele HA, cu countdown.", defaultDwell: 12, skins: ["paper", "minimal", "glass", "editorial", "neon", "terminal"], options: [{ key: "entities", label: "Calendare (entity_id)", type: "list", placeholder: "calendar.personal" }] },
  pomodoro: { id: "pomodoro", label: "Pomodoro", description: "Timer de focus controlat din /home. Vizibil doar când rulează.", defaultDwell: 15, skins: ["editorial", "minimal", "neon", "glass", "terminal", "paper"], options: [{ key: "workMin", label: "Lucru (min)", type: "number", min: 5, max: 90 }, { key: "breakMin", label: "Pauză (min)", type: "number", min: 1, max: 30 }] },
  network: { id: "network", label: "Rețea", description: "Ping, trafic up/down, Tailscale peers online.", defaultDwell: 10, skins: ["terminal", "neon", "minimal", "glass", "editorial", "paper"], options: [{ key: "pingHost", label: "Host ping", type: "text", placeholder: "1.1.1.1" }] },
  countdown: { id: "countdown", label: "Countdown", description: "Zile până la evenimentele tale.", defaultDwell: 10, skins: ["editorial", "minimal", "glass", "paper", "neon", "terminal"], options: [{ key: "events", label: "Evenimente", type: "list", placeholder: "2026-12-24 Crăciun", hint: "o linie: YYYY-MM-DD Titlu" }] },
  quote: { id: "quote", label: "Citat", description: "Un citat pe zi, tipografic, peste artă.", defaultDwell: 15, skins: ["paper", "editorial", "glass", "minimal", "neon", "terminal"], options: [{ key: "lang", label: "Limba", type: "select", choices: [{ value: "ro", label: "Română" }, { value: "en", label: "Engleză" }] }] },
  ambient: { id: "ambient", label: "Ambient (noapte)", description: "Doar fundal și un ceas mic. Activ automat în intervalul de noapte.", defaultDwell: 60, skins: ["glass", "minimal", "editorial", "neon", "paper", "terminal"], options: [{ key: "nightOnly", label: "Doar noaptea", type: "toggle", default: true }] },
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

export const SKIN_META: Record<TurzxSkin, { label: string; description: string }> = {
  minimal: { label: "Minimal", description: "Fundal închis, accent, fără ornamente." },
  glass: { label: "Glass", description: "Plăci translucide peste fundal foto." },
  neon: { label: "Neon", description: "Contururi luminoase, glow, negru adânc." },
  editorial: { label: "Editorial", description: "O cifră dominantă, tipografie mare." },
  terminal: { label: "Terminal", description: "Monospace verde/ambră, linii de scanare." },
  paper: { label: "Paper", description: "Fundal deschis, serif, calm." },
};

export const BG_SOURCE_META: Record<TurzxBgSource, { label: string; description: string }> = {
  folder: { label: "Folder local", description: "Imagini dintr-un folder de pe acest PC." },
  apod: { label: "NASA APOD", description: "Poza astronomică a zilei." },
  met: { label: "Met Museum", description: "Opere CC0 din The Met." },
  artic: { label: "Art Institute Chicago", description: "Opere din domeniul public." },
  commons: { label: "Wikimedia Commons", description: "Poza zilei de pe Commons." },
};
