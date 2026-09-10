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

| what | where |
|---|---|
| VM | `homeassistant`, Gen2, 6 GB / 4 vCPU / 64 GB, `E:\Hyper-V\homeassistant` |
| switch | **External** (`Windows 11 Enterprise`) — see below |
| LAN | `192.168.100.232` (reserve the MAC in the router) |
| tailnet | `100.80.94.97`, `homeassistant.taild1532d.ts.net`, `tag:appliance` |
| web UI | `http://192.168.100.232` — **port 80, not 8123** |
| custom domain | `https://home.dragoscatalin.ro` (tailnet only) |
| host OS shell | `ssh -p 22222 root@192.168.100.232` |
| add-on shell | `ssh root@192.168.100.232` |

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
one. Also, `POST /addons/<slug>/options` *replaces* the whole options object
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
- **Bluetooth (BLE sensors, presence)**: use an **ESPHome Bluetooth Proxy** —
  a ~5 EUR ESP32 flashed from the HA web UI. Several of them give better
  coverage than one radio ever would.

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
- `infra/tailscale-home-acl.hujson` — tailnet policy (source of truth)
