# Home Assistant — operations & setup

Home Assistant OS runs as a Hyper-V appliance on this host, reachable on the
LAN, over Tailscale, and at `https://home.dragoscatalin.ro` with a real
certificate. Everything here is reproducible from `scripts/`.

## Why an appliance VM and not a container

Only **Home Assistant OS** ships the Supervisor, and the Supervisor is what
provides add-ons (Tailscale, Mosquitto, Zigbee2MQTT, ESPHome, Let's Encrypt)
and the automatic pre-update backups. The `homeassistant/home-assistant`
Docker image is "Container mode": no Supervisor, no add-ons, no updates from
the UI. Each of those add-ons would become a hand-maintained compose file.

Cost of the choice: ~6 GB RAM and 64 GB of disk reserved permanently, and the
VM stops when the host reboots — mitigated with `AutomaticStartAction = Start`
and a 30 s delay.

## Layout

| what          | where                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| VM            | `homeassistant`, Gen2, 6 GB / 4 vCPU / 64 GB, `E:\Hyper-V\homeassistant` |
| switch        | **External** (`Windows 11 Enterprise`) — see below                       |
| LAN           | `192.168.100.232` (reserve the MAC in the router)                        |
| tailnet       | `100.80.94.97`, `homeassistant.taild1532d.ts.net`, `tag:appliance`       |
| web UI        | `http://192.168.100.232` — **port 80, not 8123**                         |
| custom domain | `https://home.dragoscatalin.ro` (tailnet only)                           |
| host OS shell | `ssh -p 22222 root@192.168.100.232`                                      |
| add-on shell  | `ssh root@192.168.100.232`                                               |

### Three listeners, deliberately non-overlapping

```
core             :80    plain HTTP        LAN + localhost
Tailscale Serve  :8443  TLS, ts.net cert  homeassistant.taild1532d.ts.net
NGINX proxy      :443   TLS, LE cert      home.dragoscatalin.ro
```

Tailscale Serve only accepts 443, 8443 or 10000 — hence 8443. **Do not put
Home Assistant itself on 443**; see the trap list below.

## Build from scratch

```powershell
# 1. Create the VM (elevated). Downloads HAOS, verifies its SHA-256.
scripts\homeassistant.ps1 -Build          # add -Latest to resolve a newer HAOS

# 2. Onboard in the browser at http://<ip> (create the admin user).

# 3. Enable host-OS SSH on 22222 (needed by steps 4-6).
scripts\homeassistant.ps1 -EnableHostSsh
ssh root@<ip> 'ha os import'

# 4. Add-ons: Tailscale, Mosquitto, File editor, Samba, Terminal & SSH.
scripts\ha-configure.ps1 -InstallAddons

# 5. Trust the reverse proxy, then log the Tailscale add-on in
#    (Settings -> Add-ons -> Tailscale -> Open Web UI -> Log In), then:
scripts\ha-configure.ps1 -TrustProxy
scripts\ha-configure.ps1 -ConnectTailscale
scripts\ha-configure.ps1 -EnableServe

# 6. Custom domain: LE certificate via Vercel DNS + NGINX on 443.
scripts\ha-configure.ps1 -PublishDomain

scripts\ha-configure.ps1                  # status
```

Tailnet policy lives in `infra/tailscale-home-acl.hujson`; apply it with
`scripts\tailscale-home.ps1 -ApplyAcl`. It is the source of truth — editing
only the Tailscale console means the next apply silently reverts it.

## Traps, all of them measured on this host

**The web UI is on port 80, not 8123.** HAOS 18's `core/info` reports
`port: 80`. Probing 8123 fails while the UI works, which reads exactly like a
crashed instance.

**`http:` in `configuration.yaml` is ignored.** On HA 2026.9 the integration
moved to UI-managed settings in `.storage/http` (`yaml_migration_done: true`).
Reverse-proxy trust must be set there (`ha-configure.ps1 -TrustProxy` does it
with `jq`). Symptom otherwise: `A request from a reverse proxy was received
from 127.0.0.1, but your HTTP integration is not set-up for reverse proxies`,
and a 400 from every proxied request. Trusted proxies must include
`172.30.32.0/23` — the Supervisor add-on network the NGINX proxy comes from.

**Never set `server_port` to 443.** Tailscale Serve already binds it. Core
fails with `[Errno 98] ... bind on address ('::', 443)`, `http` fails to set
up, every dependent integration fails with it, and HA boots into **recovery
mode with no frontend**. Recovery: set it back to 80 in `.storage/http` and
`ha core restart`.

**Enable Serve only after the node is logged in.** Otherwise the add-on's
`share-homeassistant` service exits 1 with no message, s6 tears the container
down, and its UI returns 502. `-EnableServe` refuses until it can prove both
preconditions.

**Secure Boot must be OFF and there is no vTPM.** HAOS is signed by neither
Microsoft template; with Secure Boot on it halts at the firmware screen.

**The switch must be External.** mDNS/Bonjour, SSDP and the UDP broadcasts
Tuya/Shelly/Sonoff/Hue/Chromecast rely on do not survive NAT. On the Default
Switch the integrations find nothing and report no error while doing it.

**Supervisor REST is not usable from outside.** `/api/hassio/...` returns 401
for a long-lived token; only the WebSocket command `supervisor/api` accepts
one. Also, `POST /addons/<slug>/options` _replaces_ the whole options object
and complains about one missing key per attempt — read, merge, write back.

## Remote access

- **Tailscale** — every device on the tailnet reaches the instance directly.
  The Companion app should use `https://home.dragoscatalin.ro` as its external
  URL and `http://192.168.100.232` as the internal one, so it switches
  automatically at home.
- **Nabu Casa** — optional, adds Alexa/Google without manual OAuth work, and
  funds the project. Turn it on in Settings → Home Assistant Cloud; it
  coexists with Tailscale.
- **Funnel is deliberately NOT enabled.** It would publish the instance on the
  open internet, which is the thing the tailnet exists to avoid.

### Certificate renewal

The Let's Encrypt add-on is not a daemon: it renews only when started.
`-PublishDomain` creates an HA automation (`letsencrypt_renew`) that starts it
at 04:30 daily; certbot exits immediately unless the cert is within 30 days of
expiry.

## Radios: Zigbee, Thread, Bluetooth

**Hyper-V has no USB passthrough on Gen2 guests, and cannot pass a Bluetooth
radio at all.** A Zigbee stick in the host is invisible to the appliance.

- **Bluetooth is solved**: `bluetooth-proxy-1` (ESP32, `192.168.100.120`) is
  an ESPHome Bluetooth Proxy in _active_ mode, so HA can connect to BLE
  devices, not just hear them. Built and flashed by
  `scripts\ha-devices.ps1 -FlashProxy -ComPort COMx` — the firmware is
  compiled inside the ESPHome add-on and flashed from the host, the only
  machine that can see the USB port. Add more proxies for range; HA merges
  them.
- **BLE LED strips** (MELK / ELK-BLEDOM / LEDBLE — the "Lotus Lantern",
  "duoCo Strip", "Happy Lighting" apps): HACS `elkbledom`, added with
  `-AddBleLed -Mac .. -Name .. -Model MELK-OA10`. Only one client may be
  connected at a time — force-close the phone app or HA cannot connect.
  Live state is not read back from the strip; control it from HA only.

- **Best long-term: an Ethernet coordinator** — SMLIGHT SLZB-06 / SLZB-06M
  (~30 EUR, PoE). It sits on the LAN, advertises over mDNS, and Zigbee2MQTT
  finds it with `port: mdns://slzb-06`. No host process, no bridge, survives
  host reboots, and can be moved to a better RF location than a PC case.
- **Interim, if a USB stick already exists**: `scripts\zigbee-bridge.ps1`
  serves the COM port over TCP, and Zigbee2MQTT connects with
  `port: tcp://192.168.100.61:6638`. Runs as a SYSTEM scheduled task with a
  firewall rule scoped to the appliance.
  ```powershell
  scripts\zigbee-bridge.ps1 -List
  scripts\zigbee-bridge.ps1 -Install -ComPort COM6
  ```

## Devices and how each was added (2026-09-12)

```powershell
scripts\ha-devices.ps1 -Inventory                # LAN + BLE + pending flows
scripts\ha-devices.ps1 -InstallCustomIntegrations   # HACS, elkbledom, connectlife
scripts\ha-devices.ps1 -ConfirmDiscovered        # DLNA, Samsung, MQTT, ESPHome
scripts\ha-devices.ps1 -AddTuya                  # QR -> scan -> re-run
scripts\ha-devices.ps1 -AddConnectLife           # Hisense AC
scripts\ha-devices.ps1 -AddBleLed -Mac BE:69:83:00:C4:0B -Name 'LED ARGB'
scripts\ha-devices.ps1 -PairAndroidTv -TvName 'Kitchen TV' -Pin 123456
```

| device                                                                                                   | integration                                      | how                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Nest Hub, Chromecast HD ×2                                                                               | Google Cast                                      | auto                                                                                             |
| Chromecast HD ×2 (remote control)                                                                        | Android TV Remote                                | discovered; **PIN on the TV**, still pending                                                     |
| Samsung Odyssey OLED G8                                                                                  | Samsung TV + DLNA                                | discovered, confirm                                                                              |
| Desk Light Bar (Ustellar), Star Projector, door + window contact sensors, presence sensor, temp/humidity | **Tuya**                                         | Smart Life `User Code` → QR scanned in the app                                                   |
| Hisense AC ×2 (Bedroom, Living room)                                                                     | **ConnectLife** (HACS `oyvindwe/connectlife-ha`) | email + password                                                                                 |
| LED ARGB strip (MELK-OA10)                                                                               | **elkbledom** (HACS) via Bluetooth proxy         | mac + model, flicker test                                                                        |
| Mosquitto                                                                                                | MQTT                                             | discovered from the add-on                                                                       |
| AlecoAir purifier                                                                                        | Tuya                                             | **pending**: it lives in the AlecoAir app; re-pair it in Smart Life and it appears automatically |

Tuya quirks: the temperature sensor reports °F by default — switched to °C in
the entity registry (`options_domain: sensor`). The integration is cloud;
devices still work locally from their own app if the cloud is down, HA does not.

Discovery duplicates: after a BLE device is configured manually, HA may still
raise a Bluetooth discovery for the same MAC. Dismiss it (`DELETE
/api/config/config_entries/flow/<id>`); `-Inventory` shows it.

**Supervisor WebSocket gotchas met here**: `config_entries/flow` is
POST/GET-only over REST — listing pending flows is WS `config_entries/flow/progress`;
entity option updates need `options_domain` + `options`, not a nested map;
`$Input` is a PowerShell automatic variable and silently breaks a parameter.

## Ambilight: screen → every light (2026-09-12)

`scripts/ambilight.ps1` owns this. DX Light (the vendor app for the 65-LED
monitor strip) is replaced by **HyperHDR 22** because DX Light drives one strip
from one screen with no API; HyperHDR captures the same DX11 frames, does HDR
tone-mapping properly, and fans out to everything through standard outputs.

```
HyperHDR (this PC, DX11 grabber 60 fps, HDR→SDR, monitor_nits 250)
  inst 0  DX Light (monitor)     udpraw :19446 → ambilight/dxlight_bridge.py → USB HID, 65 LEDs, ~59 fps
  inst 1  PC glow (OpenRGB)      udpraw :19447 → ambilight/openrgb_bridge.py → OpenRGB SDK :6742
                                 (3 regions: left / whole / right → case strips, GPU, board)
  inst 2  Room lights (HA)       home_assistant driver → BLE strip (whole); bar is white-only, set by the scenes
  MQTT client ──────────────────► Mosquitto add-on, topic HyperHDR/JsonAPI
Home Assistant ◄─ ha-scenes.yaml package: movie / music / off, notify flash, webhooks,
                  phone-notification colours (Companion "Last notification" sensor)
```

Four logon tasks (`vmui-ambilight-*`) start HyperHDR `--service`, OpenRGB
`--server`, and the two Python bridges; each restarts on failure. `-Status`
shows task/process state and what each instance is currently showing.

Traps:

- **HyperHDR's HA driver assumes `:8123`.** This appliance serves on `:80`, so
  `homeAssistantHost` must be `ip:80` or every request is a `408 Timeout`.
- **`/json-rpc` over HTTP only ever addresses instance 0** and rejects an
  `instance` field. MQTT is the multi-instance path: one message carries an
  array, and `instance/switchTo` inside the array retargets the commands that
  follow. `script.ambilight_all` builds that array for `[0,1,2]`.
- **`R` and `S` are PowerShell aliases** (`Invoke-History`, `Set-Variable`).
  A helper named `R` re-ran the terminal history. Use longer names.
- **The DX Light strip is a raw HID device** that DX Light and HyperHDR both
  open; whichever writes last wins and it flickers. `-Install` removes DX
  Light from `HKCU\...\Run` and kills it.
- **OpenRGB closes when its window closes** even with `minimize_on_close`;
  the bridge reconnects with backoff instead of dying.
- **Companion "Last notification" never fires for HA's own notifications**,
  so `notify.mobile_app_*` cannot be used to test it. Entity appears in HA
  only after the first notification from an allow-listed app.
- Mosquitto add-on options via Supervisor WS need `data.options = {...}`;
  posting the options object flat returns "extra keys not allowed".

The MELK BLE controller is one colour for the whole strip and can never be a
real ambilight target — `ambilight/wled-strip.md` is the WLED replacement.

## The `/home` page and https://mui.dragoscatalin.ro (2026-09-12)

vmui has a phone-first smart-home surface at `/home`: a floor plan of the
four rooms with each device as a dot that glows in its live colour, a Devices
list, and an Ambilight tab (movie/music/warm modes, screen capture on/off,
HyperHDR effects, notification flash test, per-instance status). State is
pushed over SSE from HA's WebSocket (`/api/home/events`); mutations are Server
Actions in `src/server/actions/home.ts`, whitelisted against the catalog in
`src/lib/home/catalog.ts` and audit-logged under account `home`. Dot
positions are saved per device in `home_layout` (Arrange mode).

Reaching it from the phone:

- `scripts/vmui-service.ps1 -Install` — production `next start` on
  `127.0.0.1:3737` as a logon task. The launcher (`vmui-service-run.mjs`)
  spawns next **detached** and exits, because a Task Scheduler console
  delivered Ctrl+C to the server ~75 s after start
  (exit `0xC000013A`). The task re-fires every 5 min; the launcher is a no-op
  while the port answers. `-Status` shows pid and uptime.
- `scripts/publish-vmui.ps1` — Vercel DNS `mui` A → PC tailnet IP, Let's
  Encrypt via lego DNS-01 (Vercel), and a Caddy route to :3737. Because
  brivio's elevated Caddy already owns :443, the route and certificate are
  **attached to it through its admin API** (:22019, `@id vmui-mui`). A
  5-minute task `vmui-publish-ensure` re-attaches after that Caddy restarts,
  or starts our own Caddy if :443 becomes free. `-Status`, `-Renew`,
  `-Remove`. Only tailnet devices can reach the IP; the name is public.

Traps:

- The Tuya Desk Light Bar reports `hs` colour support but its firmware
  `work_mode` enum is `['music','white']`, so any colour call is an HA 500
  ("Server got itself in trouble"). Catalog `whiteOnly: true` hides the
  colour picker; the action refuses rgb for it. Warmth/brightness work.
  It must also stay OUT of HyperHDR's `lamps`: one 500 disables the whole
  `home_assistant` device, strip included, and the room goes static
  (symptom seen 2026-09-14).
- **Capture follows the Windows PRIMARY display** (`device: auto`). The
  film monitor (Odyssey) is the secondary, so `reorder_displays = 1`. Wrong
  value shows as an endless `AcquireNextFrame didn't return the frame` and
  every light static. `systemGrabber` is global: write it as part of the
  full instance-0 config, LAST — a setconfig containing only
  `systemGrabber` resets every instance's `device` to `file`.
- `ambilight.ps1 -Status` now shows device type, LEDDEVICE state, grabber
  display/fps and the bridge's last fps line. "task=Running" alone proved
  nothing: all four tasks were running while no frame moved.
- Task Scheduler consoles deliver Ctrl+C to console apps started as tasks
  (`0xC000013A`). The Python bridges run under `pythonw.exe` and log to
  `.copilot-tmp/service-logs/*-bridge.log`; HyperHDR/OpenRGB are GUI apps
  and were never affected.
- Caddy admin: `PUT` creates (fails if the key exists), `PATCH` replaces,
  `POST` appends. A `POST` to `load_files` nests an array and the whole
  config load is rejected.
- No `/api/error_log` on this HA build; read tracebacks with
  `ssh -p 22222 root@… 'ha core logs'`.

## ESP32 desk display (2026-09-14)

The ideaspark ESP32 that is Home Assistant's Bluetooth radio also has a
0.96" two-colour SSD1306 (rows 0-15 yellow, 16-63 blue), a BOOT button and
a blue LED on GPIO2. Firmware = ESPHome from `esp32/home-display.yaml.tmpl`,
rendered and compiled by `scripts/esp32-display.ps1` inside the ESPHome
add-on and flashed over OTA or `COM10`.

**Architecture.** The board has ~300 KB heap and no PSRAM, so it renders
nothing. vmui composes every view as a 1-bit 128x64 BMP (1 086 bytes) at
`/api/esp/display/<node>?k=ESP_DISPLAY_TOKEN` (`src/lib/esp/`) and the
board pulls it every 3 s with `online_image`. Caddy exposes only
`/api/esp/*` on `192.168.100.61:8737` (plain HTTP, LAN) — `-Publish` adds
that server to the :443 Caddy and `publish-vmui.ps1 -Ensure` re-adds it
when brivio's Caddy restarts. Offline (PC down) the board shows its own
clock + wifi/ha status.

**Views** (`src/lib/esp/views.ts`), rotating every 8 s: clock, weather,
activity (HA state changes + Assist requests, `src/lib/esp/activity.ts`),
home status, ambilight, shopping list, last vmui actions, system.
**BOOT**: short = next view, double = pause, long = movie mode on/off
(`/api/esp/button`). **Blue LED** blinks 40 ms per new frame, steadily while
WiFi is down. The red LED next to USB is hardwired to 5V.

Traps: OLED is on **GPIO21/22** on this unit (5/4 → `Communication
failed`); BLE proxy + image download exhausted heap → passive scan,
`max_connections: 1`, `sram1_as_iram`, log level WARN (INFO log lines go
through the API overflow buffer, which is where `bad_alloc` hit);
`online_image` needs `Content-Length` or it reports `Size: 0` and draws
nothing; opening the COM port resets the board unless DTR/RTS are cleared
before open; a reboot loop with `rst:0x3 (SW_RESET)` and no backtrace was
`E BOD: Brownout detector was triggered` (WiFi burst + BLE on the weak 3V3)
→ `wifi.output_power: 8.5dB`. HA prefixes the entities with the area:
`sensor.office_bluetooth_proxy_1_*`. vmui's own port needs a persistent
WinNAT exclusion (`netsh int ipv4 add excludedportrange … 3737/8737`) or a
reboot can hand it to Hyper-V.

## Tray icon and console-free tasks (2026-09-14)

`ambilight/tray.py` (task `vmui-tray`, pythonw) shows one icon: green =
HyperHDR + vmui + bridges up, amber = something stopped, red = HyperHDR
unreachable. Menu: Movie/Music/Off, screen capture, clear effects, open
mui.dragoscatalin.ro, local `/home`, wall compensation, HyperHDR settings,
restart stack. Console apps started by tasks (`node`, `pwsh`, `caddy`) go
through `scripts/hidden-run.vbs` — Task Scheduler's _Hidden_ only hides the
task, the console still flashes. Tasks run with the **Interactive** token:
S4U processes cannot be stopped from the desktop (took an admin `taskkill`
twice) and cannot reach the user's Caddy admin port.

**Wall compensation** (Ambilight tab → _Wall compensation_): the monitor
strip lights a blue wall, so pick the wall colour and pull the slider until
white on screen reads white on the wall. The UI calls `ambilight.ps1 -Set
wallHex=… wallStrength=…` (`src/lib/home/ambilight-settings.ts`), so
`ambilight/settings.json` stays the single source and the formula lives once,
in `New-WallCompensation`.

## Turzx 3.5" desk screen (2026-09-14)

The USB LCD next to the ESP32 is a **Turzx 3.5"** 320×480, VID `1a86` PID
`5722`, serial `USB35INCHIPSV2`, COM11. Despite the rev-B-looking IDs it
answers **only the 6-byte "rev A" command word** (the one in selfie-screen's
`TuringLcd.kt`): bytes 0–4 pack `x y ex ey` at 10 bits each, byte 5 is the
command — `102` clear, `108/109` off/on, `110` brightness (0 = brightest),
`121` orientation (16-byte form), `197` bitmap followed by RGB565
**little-endian** pixels. The rev B 10-byte protocol (`CA/CB/CC/CE`) is
accepted silently and draws nothing — an afternoon lost. Driver:
`turzx/lcd.py`; landscape is done by rotating each rect onto the native
portrait framebuffer. Link rate measured at **~365 KB/s** and linear (300 KB
full frame in 0.82 s, 3 KB in 8.5 ms), so `anim.dirty_rects` sends exact
row runs narrowed to changed columns and `Renderer.push` caps bytes per frame
at link-rate/fps, streaming the remainder on later frames. Continuous
effects are quantised (`Pulse(steps=)`, `qsin`) so a breathing underline does
not repaint every frame; view transitions are strip wipes, never blends.

`turzx/turzx.py` (task `vmui-turzx`, pythonw, restarts on failure and
reconnects when the screen is unplugged) polls
`GET /api/turzx/state?k=ESP_DISPLAY_TOKEN` every 3 s and rotates the views in
`turzx/views.py`: morphing clock, animated weather, home, live ambilight
colour, PC gauges (psutil + NVML), HA activity, now playing with album art,
shopping/actions lists. Metric everywhere. `python turzx\turzx.py --once`
writes one PNG per view to `.copilot-tmp/turzx/` for layout checks without
the hardware; the log is `.copilot-tmp/service-logs/turzx.log` (fps and KB/s
once a minute).

Settings (`turzx_settings` row 1, schema v2 in `src/lib/turzx/settings.ts`,
catalog of views/skins/sources in `src/lib/turzx/catalog.ts`) are edited from
`/home?tab=displays` — the **view manager**: per view enable/order, its own
dwell (min 5 s), skin, optional own background and view-specific options
(currencies, coins, calendars, countdown dates, ping host, pomodoro
lengths…); global fps, transition, day/night brightness and window, accent,
180° flip, global background and how often photos rotate. The header
underline is the **dwell progress bar** — full on entry, shrinking to the
left until the view changes. Pomodoro is started/stopped from the same tab
(row 2 of the table, `pomodoroAction`); the view only appears while running.

**Views (19)**: clock, weather, home, ambilight, pc, activity, media, lists,
fx (BNR via `curs.bnr.ro` — `www.bnr.ro` returns HTML), crypto (CoinGecko),
photo (full-screen picture + caption), fleet (vmui instances), climate (24 h
HA history), calendar (HA `calendar.*`), pomodoro, network (ping, psutil
throughput, Tailscale peers), countdown, quote, ambient (night-only clock).

**Skins (6)** in `turzx/skins.py`: minimal, glass (translucent panels over a
photo, 1 px text shadow), neon (accent outlines + glow), editorial (one
dominant figure, uppercase labels), terminal (amber monospace, scanlines,
ignores photos), paper (light, Georgia). A view never hard-codes colour or
font; `--once --all-skins` renders all 114 combinations to
`.copilot-tmp/turzx/` and `.copilot-tmp/uicheck/sheet.py` tiles them.

**Backgrounds** (`turzx/backgrounds.py`): local folder (recursive, ≤ 2000
files) and the online pool the API pre-fetches from dashy's licence-vetted
free sources (NASA APOD, Met CC0, Art Institute, Commons POTD;
`src/lib/turzx/feeds.ts`). Downloads land pre-cropped to 480×320 in
`.copilot-tmp/turzx/bg/`. A photo is swapped **only at view entry** (that
300 KB repaint coincides with the transition) and at most every
`bgRotateMin`; `dim`/`blur` keep text legible. Long strings render through
`anim.Marquee` — clipped to their slot and scrolled when they do not fit.

**Phone notifications** (`turzx/overlay.py`, settings → _Notificări de pe
telefon_): while `binary_sensor.human_presence_sensor_occupancy` is on, a
new entry on `sensor.dragos_s_s25_ultra_last_notification` (Companion app
"Last notification", allow list = messaging apps) pops a card over the
current view: sender avatar with the app badge, sender, up to 7 wrapped
lines then a slow vertical scroll, faded backdrop, slide in/out from the
nearest edge; position top/centre/bottom, duration, "show text" and the
package list are configurable. Rotation pauses while a card is up.
`python turzx\turzx.py --demo-notify` pops a fake WhatsApp card after 5 s.
The Companion app was installed and granted notification access over adb
(`cmd notification allow_listener …NotificationSensorManager`, then
disallow/allow once to force the bind); the sensor entity only appears in
HA after the first notification from an allowed app.

**Trap — "frozen screen".** Under sustained load the panel occasionally

**Seeing what the panel shows.** The renderer writes its last pushed frame
to `.copilot-tmp/turzx/mirror.png` once a second; `/api/turzx/mirror`
serves it (session or `?k=` token) and `/home?tab=displays` shows it live
("Oglindă live", 1:1 or 2×). **Layout audit**: `python turzx\turzx.py
--once --all-skins --audit` renders every view × skin, records every text
box drawn (`Skin.text`, `Marquee.draw` → `turzx/audit.py`), and flags
off-screen or overlapping text with `*-audit.png` overlays; exit 1 if any.
Run it after touching any view. `.copilot-tmp/uicheck/sheet.py v1,v2` tiles
the PNGs for a quick eyeball.
stops drawing (and eventually stops ACKing → `SerialTimeoutException`).
Only the full init sequence (hello + CLEAR + orientation + on) wakes it;
lighter resyncs and plain rewrites do nothing. `Renderer.push` runs
`lcd.resync()` + an immediate full repaint on a write timeout and every
60 s as a watchdog. **Do not** concatenate the 6-byte bitmap header with the
pixel payload into one `write()` — the panel then ignores the command
entirely (black screen, every byte ACKed); the header must be its own
transfer. When the screen goes black after a driver change, replay the
original minimal test script before theorising.

**Trap — which port is the Turzx.** COM6 (`1a86:ca21`, "CT21INCH") and COM7
(`1d6b:0121`, sn `20080411`) are a _different_ Turing-family screen (rev C,
"chs_5inch"). Sending rev-B-sized frames to it wedged its CDC endpoint (CTS
low, write timeouts) until an elevated PnP disable/enable. Identify a screen
by unplug/replug (`.copilot-tmp/uicheck/usb-watch.py`) before writing to it.
COM10 is the ESP32's CH340.

### Views, batch 3 (2026-09-15)

23 views now (`src/lib/turzx/catalog.ts` ↔ `turzx/views*.py`); the four new
ones ship **disabled** — turn them on in `/home?tab=displays`:

| view            | source                                                                                                               | notes                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `copilot`       | every VS Code profile's `github.copilot-chat/session-store.db` (read-only copy + WAL, `feeds.agentSessions`)         | repo, turns today, last prompt per active session. Store is ~110 MB → copied **async**, 30 s TTL, stale-while-revalidate. |
| `focus`         | `user32` foreground window + `GetLastInputInfo`, sampled on the host thread (`turzx.py::_Focus`)                     | active window + time in it; day split cod/terminal/browser/chat/media; idle after N min.                                  |
| `anniversaries` | `options.people` lines `YYYY-MM-DD Name`                                                                             | next one big with age + days; 29 Feb → 1 Mar.                                                                             |
| `energy`        | HA sensors with `device_class` power/energy/current (`feeds.energyReadings`); batteries from `device_class: battery` | `mA` → W at 230 V (Tuya AC plugs only expose current). Cost = kWh × `pricePerKwh` (default 1.3 lei).                      |

Content added to existing views: weather → next 6 hours strip, UV / dew
point, moon on clear nights (`feeds.moonPhase`, local synodic maths);
clock → sunrise/sunset ticks on the day bar, moon glyph 21:00–05:00; home →
low-battery badge in the header, red edge pulse when the door has been open

> 2 min; media → **synced lyrics** from LRCLIB (`feeds.syncedLyrics`, keyless,
> 24 h cache) replace the equaliser while playing; pc → disk fill row
> (`options.disks`); crypto → `holdings` portfolio line; fx → `watchAmount`
> ("1000 EUR = … lei") and XAU (BNR lists gold per gram); photo → quantised
> Ken Burns drift (one crop every ~2 s, so ~0.5 full frames/s on the link).

Rotation is now content-aware: `View.dwell_scale(state)` shortens a view's
dwell when it has little to show (empty shopping list, no activity, no VM
running). The poller adapts too: 2 s while something plays, 3 s by day,
10 s in the night window.

### Moving the smart plug, the AlecoAir purifier and the ACs into HA

The `energy` view is empty until a power sensor exists in HA. The plug and
the purifier are Tuya-cloud devices living in their vendor apps; HA's Tuya
integration only sees what is in **Smart Life** under the account whose QR
we scanned (`ha-devices.ps1 -AddTuya`). Phone steps, ~5 min:

1. **Priza**: in the vendor app, remove it (or hold its button 5 s until it
   blinks fast). Smart Life → `+` → it appears under "Discovering devices"
   (same 2.4 GHz WiFi as the phone) → add. Within a minute HA shows
   `sensor.<name>_power` (W) and `sensor.<name>_today_energy` (kWh) — the
   view picks them up with no config.
2. **AlecoAir**: same — AlecoAir's app is a Tuya OEM skin, the device pairs
   into Smart Life directly (hold the WiFi button until it blinks). You get
   `fan.*`, `sensor.*_pm25`, `switch.*` in HA; the `home` view will show the
   PM2.5 once the entity exists (`sensor.*pm25*`).
3. **Hisense AC ×2** already report `_electricity` (mA) and `_daily_energy`
   via ConnectLife; nothing to do. They read 0 W when off — expected.

Do **not** re-run `-AddTuya`; the existing config entry polls the account
and new devices show up on their own. If one does not, Settings → Devices →
Tuya → ⋮ → Reload.

### Health view (Samsung Health → Health Connect → HA companion) — 2026-09-16

`health` reads `sensor.dragos_s_s25_ultra_<metric>` — the Health Connect
sensors of the HA companion app (2026.6.5), all enabled in Companion app →
Manage sensors → search "health". This HA server is on **US units**, so the
companion publishes ft / g / inHg / fl oz; `healthReadings()` in
`src/lib/turzx/feeds.ts` converts to metric — never convert in the renderer.
Options: `stepsGoal`, `sleepGoalH`, `device` (entity slug).

What was actually found on the phone (adb serial **RZCYA0LJ0NZ**; the other
serial is an old A51):

- Samsung Health has read **and write** grants for every Health Connect
  category, yet Health Connect held only the phone pedometer's steps. Samsung
  Health showed 0 steps and "not synced in 3 days" (that banner is Samsung
  *Cloud*, WiFi-only). Galaxy Watch3 (B827) is connected, 100 % battery,
  plugin `com.samsung.android.gearnplugin` present — so the gap is between
  the watch and Samsung Health, not between Samsung Health and HC. Wearing
  the watch for a day and opening Samsung Health once fills HC; until then
  `heart_rate`, `sleep_duration`, `oxygen_saturation` stay `unknown` and the
  view shows dashes.
- OKOK scale app (`com.chipsea.btcontrol.en`) has **no** Health Connect
  permissions; its weight never reaches HA. Samsung Health → Settings →
  Accessories lists only Samsung/Xiaomi scales, so the BT-direct route is
  closed for this scale. Options: type weight in Samsung Health, or a BLE
  bridge (openScale / ESPHome `xiaomi_miscale`-style sniffer on the office
  Bluetooth proxy) — the scale broadcasts weight as BLE adverts while you
  stand on it.
- A `HealthConnectPermissionActivity` exists but is not exported; the sensors
  can only be toggled in-app. Everything else (HC home, app access) opens
  with `am start -a android.health.connect.action.HEALTH_HOME_SETTINGS`.

### Copilot signals on the phone

`/api/copilot/event` now also calls `notify.<phoneNotify>` (default
`mobile_app_dragos_s_s25_ultra`, editable in /home → Semnale Copilot):

- one card per **session** (`tag: copilot-<session>`): title per event,
  subtitle `project · chat title`, event colour, mdi icon, high-importance
  channel for `ask` which is `sticky` until the next tool call clears it by
  tag. `persistent: true` is deliberately not used — the companion refuses
  `clear_notification` on persistent cards (verified with
  `adb shell cmd notification list`, which shows the *live* set; `dumpsys
  notification` includes history and lies).
- one silent summary card (`tag: copilot-agents`, low importance): active
  sessions from the local VS Code session stores — repo, profile, turns
  today, last request — refreshed on every event, cleared when idle.
- both respect quiet hours (23:30–07:30 by default).

The desk card and the phone card carry the project (cwd leaf, exactly the
VS Code taskbar title) and the chat tab title, read by
`~/.copilot/hooks/copilot-signal.ps1` from the first 64 KB of
`workspaceStorage/*/chatSessions/<session_id>.jsonl` (`customTitle`).

## Backups

`ha backups new` inside the appliance, or Settings → System → Backups. The
Samba add-on exposes `\\192.168.100.232\backup` so snapshots can be copied to
the host. Credentials are in `.private/credentials.env` (`HA_SAMBA_PASS`).

## Files

- `scripts/homeassistant.ps1` — build/start/stop/status, host-SSH enablement
- `scripts/ha-configure.ps1` — add-ons, proxy trust, Tailscale, custom domain
- `scripts/tailscale-home.ps1` — personal-tailnet ACL, auth keys, device list
- `scripts/scan-smart-devices.ps1` — ARP + mDNS + SSDP + Bluetooth inventory
- `scripts/zigbee-bridge.ps1` — USB coordinator over TCP
- `scripts/ambilight.ps1` — HyperHDR instances, logon tasks, HA scenes, modes
- `ambilight/` — bridges (`bridges.py` hosts `dxlight_bridge.py` + `openrgb_bridge.py` in one process), layout
  helper, `ha-scenes.yaml` package, WLED upgrade notes
- `scripts/vmui-service.ps1` + `vmui-service-run.mjs` — production vmui task
- `scripts/publish-vmui.ps1` — DNS + certificate + Caddy for mui.dragoscatalin.ro
- `scripts/esp32-display.ps1` + `esp32/home-display.yaml.tmpl` — ESP32 OLED firmware
- `src/lib/esp/` — framebuffer, 5x7 font, views, gallery, activity feed
- `ambilight/tray.py` — tray icon; `scripts/hidden-run.vbs` — window-less task launcher
- `infra/tailscale-home-acl.hujson` — tailnet policy (source of truth)
