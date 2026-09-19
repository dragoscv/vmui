# vmui desktop — tray + control window

Tauri 2 (Rust) + React 19 + Tailwind v4. One tray icon whose colour is the
health of the home stack, and a native window to configure everything that
used to need the browser. Replaced `ambilight/tray.py` (pystray) on
2026-09-19; the Task Scheduler entry `vmui-tray` now runs
`src-tauri/target/release/vmui-desktop.exe --hidden` at logon.

## Pages

| page      | talks to                                              | does                                                                                 |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Ambilight | HyperHDR JSON-API (ws :8090), `ambilight/settings.json`, `scripts/ambilight.ps1 -Configure` | modes (HA scripts), capture toggle, per-instance effect/colour, idle colours, wall compensation, smoothing, HDR |
| Casă      | vmui `/api/display/state` + `/api/display/control` (Pi) | rooms → device tiles (tap = toggle, ⋯ = sheet), scenes, water                        |
| Ecrane    | vmui `/api/desktop/settings` (Pi)                     | Nest Hub + Turzx settings, same schemas as the `/home` cards                          |
| Servicii  | `schtasks`, `.copilot-tmp/service-logs/*.log`         | start/stop/restart every `vmui-*` task, tail logs                                     |
| PC        | `scripts/pc-action.ps1` (fixed verbs), autostart plugin | lock / display off / sleep / volume / maintenance verbs, autostart toggle             |

Credentials come from `.private/credentials.env` (HA_URL, HA_TOKEN,
HYPERHDR_ADMIN_PASS, ESP_DISPLAY_TOKEN). The repo root is found by walking up
from the exe until `ambilight/tray.py` exists; override with `VMUI_ROOT`.

## Build

```powershell
pnpm install                         # workspace root
cd apps\desktop
pnpm exec tauri build                # ~2–4 min; exe + NSIS under src-tauri/target/release
```

The running instance locks the exe: `Stop-Process -Name vmui-desktop` first,
then `schtasks /run /tn vmui-tray` to start the new build hidden.

## Test without taking the screen

`pnpm dev` then open `http://localhost:1430/?mock=1&k=<ESP_DISPLAY_TOKEN>` in a
browser: `src/mock.ts` answers `invoke()` for the Rust commands and proxies
vmui calls to the Pi through vite (`/vmui`). Anything that goes to
`/api/display/control` hits REAL devices — route it to a stub in Playwright
(`page.route('**/vmui/api/display/control*', …)`) before clicking tiles.

## Gotchas

- `tauri-plugin-window-state` restores visibility and defeats `--hidden`;
  the plugin is built without `StateFlags::VISIBLE` and `setup()` hides
  explicitly when the flag is present.
- Closing the window hides it (`CloseRequested` → `prevent_close`). Quit only
  from the tray.
- Nested buttons inside a clickable tile need `onPointerDown` +
  `onClick` `stopPropagation` (the tile is a `role=button` div).
