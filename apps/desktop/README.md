# vmui desktop — tray + control window

Tauri 2 (Rust) + React 19 + Tailwind v4. One tray icon whose colour is the
health of the home stack, and a native window to configure everything that
used to need the browser. Replaced `ambilight/tray.py` (pystray) on
2026-09-19; the Task Scheduler entry `vmui-tray` now runs
`src-tauri/target/release/vmui-desktop.exe --hidden` at logon.

The same crate is the **Android app** (`ro.dragoscatalin.vmui`, 2026-09-19):
`#[cfg(desktop)]` = tray + local stack, `#[cfg(mobile)]` = window only,
everything proxied to the Pi's vmui with a per-device token. Same React UI,
bottom tabs under 768 px.

## Android

```powershell
pwsh -File scripts\android-release.ps1 -Install     # build signed APK, publish on the Pi, adb install
pwsh -File scripts\android-release.ps1 -SkipBuild   # re-publish the last build
cd apps\desktop; pnpm exec tauri android dev        # live reload on the connected phone
```

- Signing: `.private/android-release.jks` + `android-keystore.properties`
  (gitignored; `gen/android/app/build.gradle.kts` reads it). Lose the keystore
  and the phone will refuse the next update — back it up.
- **Pairing** (no address, no token typed): the app browses mDNS
  `_vmui._tcp` (avahi advert on the Pi, `pi/avahi-vmui.service`) and probes
  `homepi` / `homepi.local` / the LAN IP, then `POST /api/devices/pair` →
  `{id, token, code}`. The 4-digit code shows on the phone; approve it from
  **vmui web → Home → Displays**, the **desktop tray/window** (Windows toast +
  "Dispozitive noi" submenu + banner) or **another paired phone** (banner). Or
  sign in with the vmui account on the phone → approved at once. Tokens are
  `vmd_…`, stored hashed in `paired_devices`, revocable from any of those
  places; `espAuthorized()` accepts them as `Authorization: Bearer` / `?d=`.
- From outside the house it is the same URL over Tailscale (the Pi is a subnet
  router for 192.168.100.0/24).
- **PC from the phone**: `POST /api/desktop/pc` on the Pi publishes to MQTT
  `vmui/pc/cmd`; the desktop tray (`src-tauri/src/agent.rs`) executes the
  fixed verbs and publishes `vmui/pc/state` retained → `sensor.vmui_pc_agent`
  in HA (`pi/ha-packages/vmui_pc.yaml`). Commands older than 60 s are dropped.
- **Pi page** (mobile "Pi" tab): `GET/POST /api/desktop/pi` — systemd units,
  containers, temp/throttle, logs; restarts need `/etc/sudoers.d/vmui`
  (`pi/sudoers-vmui`, installed by pi-deploy).
- **Self-update**: `android-release.ps1` puts the APK at
  `/srv/homepi/vmui/public-apk/`; the app compares `versionCode` with
  `GET /api/desktop/apk?meta=1` and offers the download (browser → package
  installer verifies the signature). Version lives in `tauri.conf.json`,
  `package.json`, `Cargo.toml` — bump all three.
- **Shortcuts** (long-press icon): Film / Stins / Apă +250 / PC — `ActionActivity`
  + `res/xml/shortcuts.xml`. **Widget**: temperature · lights · water with a
  +250 ml button (`VmuiWidget`, classic RemoteViews). Both read the pairing
  from `<dataDir>/conn.json` (Tauri's `app_data_dir()` = `Context.getDataDir()`).
- Test on the **A51** (`adb -s R58N94BMLJY`), not the S25 (daily phone).
  WebView nodes are invisible to `uiautomator dump`; drive it with
  `adb shell input tap x y` + `screencap`.
- No TLS in the Rust HTTP client on purpose (`ureq` without `rustls`) — the
  Pi is plain http; it also keeps `ring` out of the NDK build, which failed
  with `'assert.h' file not found`.

## Pages

| page      | talks to                                                                                    | does                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Ambilight | HyperHDR JSON-API (ws :8090), `ambilight/settings.json`, `scripts/ambilight.ps1 -Configure` | modes (HA scripts), capture toggle, per-instance effect/colour, idle colours, wall compensation, smoothing, HDR |
| Casă      | vmui `/api/display/state` + `/api/display/control` (Pi)                                     | rooms → device tiles (tap = toggle, ⋯ = sheet), scenes, water                                                   |
| Ecrane    | vmui `/api/desktop/settings` (Pi)                                                           | Nest Hub + Turzx settings, same schemas as the `/home` cards                                                    |
| Servicii  | `schtasks`, `.copilot-tmp/service-logs/*.log`                                               | start/stop/restart every `vmui-*` task, tail logs                                                               |
| PC        | `scripts/pc-action.ps1` (fixed verbs), autostart plugin                                     | lock / display off / sleep / volume / maintenance verbs, autostart toggle                                       |

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
