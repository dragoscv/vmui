// Browser-only harness: when the page is NOT inside Tauri (`window.__TAURI_INTERNALS__`
// missing) we answer `invoke()` from a small in-memory stub so the UI can be
// driven in a normal browser (Playwright) without taking the user's screen.
// Never bundled in the app: main.tsx imports it only under ?mock=1.
type Handler = (args: Record<string, unknown>) => unknown;

const settings: Record<string, unknown> = { wallHex: "#439ebf", wallStrength: 0.5, gamma: 1, saturation: 1, luminance: 1, idleStripHex: "#a00000", idleGlowHex: "#500000", idleAfterSec: 20, stripSmoothMs: 150, glowSmoothMs: 700, roomSmoothMs: 800, roomBrightness: 140, grabberFps: 60, hdrToneMapping: true, videoFollow: true, videoAutoMovie: true };
const tasks = ["vmui-ambilight-hyperhdr", "vmui-ambilight-openrgb", "vmui-ambilight-bridges", "vmui-service", "vmui-turzx", "vmui-tray"].map((name, i) => ({ name, status: i === 3 ? "Ready" : "Running", running: i !== 3 }));
const VMUI = "/vmui";
const K = new URLSearchParams(location.search).get("k") ?? "";
const calls: Array<{ cmd: string; args: unknown }> = [];
(window as unknown as { __calls: unknown }).__calls = calls;

const handlers: Record<string, Handler> = {
  health: () => ({ state: "ok", detail: "idle · captură oprită", vmui: true, ha: true, hyper: true, grabber: false, source: "idle", tasks }),
  tasks: () => tasks,
  task_action: () => undefined,
  tail_log: ({ name }) => `${name}: 12:00:01 mock line 1\n12:00:02 mock line 2`,
  open_path: () => undefined,
  settings_get: () => settings,
  settings_set: ({ patch }) => Object.assign(settings, patch as object),
  ambilight_configure: () => "ok",
  hyper_instances: () => [0, 1, 2].map((id) => ({ id, name: ["First LED instance", "PC glow", "Room lights"][id], running: true, grabber: false, source: "idle", brightness: 100, effects: ["Breath", "Fire"] })),
  hyper_send: () => [],
  ambilight_mode: () => undefined,
  pc_action: ({ action }) => `${action} ok`,
  ha_call: () => ({}),
  vmui_get: async ({ path }) => { const p = String(path); const r = await fetch(`${VMUI}${p}${p.includes("?") ? "&" : "?"}k=${K}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); },
  vmui_send: async ({ method, path, body }) => { const p = String(path); const r = await fetch(`${VMUI}${p}${p.includes("?") ? "&" : "?"}k=${K}`, { method: String(method), headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json().catch(() => ({ ok: true })); },
  app_info: () => ({ root: "E:\\gh\\vmui", vmui: VMUI, haUrl: "", displayUrl: `${VMUI}/display?k=${K}`, version: "mock" }),
  "plugin:event|listen": () => 0,
  "plugin:event|unlisten": () => undefined,
  "plugin:autostart|is_enabled": () => false,
  "plugin:window|hide": () => undefined,
  "plugin:window|minimize": () => undefined,
  "plugin:window|toggle_maximize": () => undefined,
  "plugin:opener|open_url": () => undefined,
};

(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" }, windows: [{ label: "main" }], webviews: [{ label: "main" }] },
  transformCallback: (cb: (v: unknown) => void) => { const id = Math.floor(Math.random() * 1e9); (window as unknown as Record<string, unknown>)[`_${id}`] = cb; return id; },
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    const h = handlers[cmd];
    if (!h) throw new Error(`mock: no handler for ${cmd}`);
    return h(args);
  },
  convertFileSrc: (p: string) => p,
};
(window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };

export { };

