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
  inst 2  Room lights (HA)       home_assistant driver → Desk Light Bar (top), BLE strip (whole)
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
- Caddy admin: `PUT` creates (fails if the key exists), `PATCH` replaces,
  `POST` appends. A `POST` to `load_files` nests an array and the whole
  config load is rejected.
- No `/api/error_log` on this HA build; read tracebacks with
  `ssh -p 22222 root@… 'ha core logs'`.

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
- `ambilight/` — bridges (`dxlight_bridge.py`, `openrgb_bridge.py`), layout
  helper, `ha-scenes.yaml` package, WLED upgrade notes
- `scripts/vmui-service.ps1` + `vmui-service-run.mjs` — production vmui task
- `scripts/publish-vmui.ps1` — DNS + certificate + Caddy for mui.dragoscatalin.ro
- `infra/tailscale-home-acl.hujson` — tailnet policy (source of truth)
