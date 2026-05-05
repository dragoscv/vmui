# Local KVM macOS — operations & troubleshooting

This document covers the **local-kvm** provider: a macOS guest running under
QEMU/KVM inside WSL2 Ubuntu, controlled by vmui.

## Architecture

```
 Windows host                                WSL2 (Ubuntu-24.04)
 ─────────────                                ──────────────────
 vmui (Next.js) ──▶ Server Action ──┐
                                    │
       VS Code task ────────────────┼──▶ spawn-watchdog.ps1 (Windows)
                                    │           │
                                    │           ▼
                                    └──▶ watchdog-mac.ps1 (Windows, hidden)
                                                │   keeps wsl.exe handle open
                                                ▼     so WSL2 doesn't idle-shut
                                          run-mac-foreground.sh (in WSL)
                                                │
                                                ▼
                                          boot-mac.sh ──▶ qemu-system-x86_64
                                                              │
                                                              ▼
                                            VNC :5900   QMP :4444   SSH :10022
```

The Windows-side watchdog process is essential: it holds an open handle on
the WSL distro, defeating WSL2's 60-second idle-shutdown that would otherwise
kill QEMU.

## Two equivalent ways to start the VM

Both routes end up running the same `watchdog-mac.ps1` with the same args.

1. **Web UI** — `Instances → local-mac → Start` calls
   `LocalKvmProvider.startInstance()` in
   [src/lib/providers/local-kvm.ts](../src/lib/providers/local-kvm.ts), which
   spawns the watchdog through `scripts/spawn-watchdog.ps1` (uses
   `Win32_Process.Create` to break out of Node's job object).

2. **VS Code task** — `vmui: start mac VM (32GB)` runs
   `scripts/watchdog-mac.ps1` directly in the foreground terminal, useful
   for live log tailing during dev.

The watchdog itself:
- syncs `run-mac-foreground.sh` from `/mnt/e/gh/vmui/scripts` on every iteration
- pre-cleans stale `qemu-nbd` connections / mounts that would lock
  `OpenCore.qcow2` (e.g. from a crashed UIScale-patch run)
- restarts QEMU automatically if it exits

## QEMU version compatibility

WSL2 Ubuntu-24.04 ships **QEMU 8.2.2**. Earlier guides for OSX-KVM use props
that this build no longer accepts:

| Removed prop | Symptom | Fix |
|---|---|---|
| `VGA.xmm`, `VGA.ymm` | `Property 'VGA.xmm' not found` → QEMU exits, watchdog restart-loops | omit them; the bare `xres`/`yres` is enough |

These were physical-screen-size hints (in mm) used by older QEMU to hint
DPI to the guest. They've been removed from the std VGA device.

## HiDPI / "everything is huge" fix

### Symptom

After boot, macOS reports:
```
Resolution: 1920 x 1080
UI Looks like: 960 x 540 @ 75.00Hz
```

The framebuffer is 1920×1080 but the UI is rendered at 2× scale (960×540
logical points). Windows, dock, and text are all twice the size they
should be.

### Root cause

QEMU's std-VGA EDID in 8.2 doesn't include physical screen dimensions
(no `xmax`/`ymax` mm property is exposed). With no physical size, macOS
falls back to assuming a high-DPI panel and engages 2× scaling.

OpenCore's `UIScale=01` NVRAM variable does **not** help — that only
affects OpenCanopy's picker, not macOS itself once the kernel boots.

The `/Library/Displays/Contents/Resources/Overrides/DisplayVendorID-…/`
plist trick is shadowed by the same-named override under
`/System/Library/...` which is SIP-protected and can't be removed.

### Fix — `displayplacer` LaunchAgent

[displayplacer](https://github.com/jakehilborn/displayplacer) is a small
CLI that calls `CGSConfigureDisplayMode` to switch resolutions at runtime.
It is installed at `/usr/local/bin/displayplacer` inside the guest, and a
LaunchAgent runs it at every login:

```bash
# /usr/local/bin/displayplacer is the v1.4.0 intel build
# ~/Library/LaunchAgents/com.vmui.display.plist:
displayplacer "id:FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF \
               res:1920x1080 hz:85 color_depth:4 \
               enabled:true scaling:off origin:(0,0) degree:0"
```

`scaling:off` is the key — that switches macOS out of HiDPI mode for the
QEMU virtual display. After the agent runs (about a second after login):

```
Resolution: 1920 x 1080
UI Looks like: 1920 x 1080 @ 85.00Hz
```

### Re-applying after a fresh install

If you reinstall macOS or the LaunchAgent is missing, run from any
WSL shell while the VM is running and SSH is up on port 10022:

```bash
sshpass -p "<password>" ssh -p 10022 dragos@127.0.0.1 << 'EOF'
curl -sL -o /tmp/displayplacer \
  https://github.com/jakehilborn/displayplacer/releases/download/v1.4.0/displayplacer-intel-v140
chmod +x /tmp/displayplacer
echo '<password>' | sudo -S install -m 755 /tmp/displayplacer /usr/local/bin/displayplacer

mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/com.vmui.display.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.vmui.display</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/displayplacer</string>
    <string>id:FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF res:1920x1080 hz:85 color_depth:4 enabled:true scaling:off origin:(0,0) degree:0</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST
launchctl unload ~/Library/LaunchAgents/com.vmui.display.plist 2>/dev/null || true
launchctl load   ~/Library/LaunchAgents/com.vmui.display.plist
EOF
```

## Troubleshooting

### `Failed to get shared "write" lock` on `OpenCore.qcow2`

A previous `qemu-nbd -c /dev/nbd0 OpenCore.qcow2` (typically from a
crashed UIScale-patch run) is still holding the image. `watchdog-mac.ps1`
now pre-cleans this on every restart, but to do it manually:

```bash
wsl -d Ubuntu-24.04 -- bash -lc '
  sudo umount -l /tmp/vmui-oc-mnt 2>/dev/null
  sudo qemu-nbd -d /dev/nbd0
  sudo rmdir /tmp/vmui-oc-mnt 2>/dev/null
  sudo fuser -v ~/OSX-KVM/OpenCore/OpenCore.qcow2  # should be empty
'
```

### VM boots into UEFI shell instead of macOS

The OpenCore boot disk attaches at `sata.2` and the Mac HDD at `sata.4`.
If you see the OVMF UEFI shell, OpenCore likely failed to enumerate
disks. Verify with:

```bash
wsl -d Ubuntu-24.04 -- bash -lc 'ls -la ~/OSX-KVM/{OpenCore/OpenCore.qcow2,mac_hdd_ng.img}'
```

Both files must exist. `OpenCore.qcow2` is mounted with `snapshot=on` so
config changes require either rebuilding the image or editing it via
`qemu-nbd` while the VM is stopped.

### Watchdog spins / restart-loops

Tail the logs to see what QEMU is rejecting:

```bash
wsl -d Ubuntu-24.04 -- bash -lc 'tail -40 /tmp/vmui-mac.log'
type .watchdog-logs\watchdog-*.log | Select-Object -Last 30
```

Common causes: missing `/dev/kvm`, file lock on `OpenCore.qcow2`,
unsupported `-device` property in this QEMU version, port already in use.

### Capture a VNC screenshot for diagnosis

```bash
wsl -d Ubuntu-24.04 -- bash -lc '
  python3 -c "
import socket,json
s=socket.socket(); s.connect((\"127.0.0.1\",4444))
def r():
    b=b\"\"
    while b\"\\n\" not in b: b+=s.recv(4096)
    return json.loads(b.split(b\"\\n\")[0])
r(); s.send((json.dumps({\"execute\":\"qmp_capabilities\"})+\"\\n\").encode()); r()
s.send((json.dumps({\"execute\":\"screendump\",\"arguments\":{\"filename\":\"/tmp/vmui-screen.ppm\"}})+\"\\n\").encode()); r()
"
  convert /tmp/vmui-screen.ppm /mnt/e/gh/vmui/.watchdog-logs/screen.png
'
```

### Stop the VM cleanly

The VS Code task `vmui: stop mac VM` does this; manually it's:

```powershell
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -match 'watchdog-mac\.ps1' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
wsl -d Ubuntu-24.04 -- bash -lc 'pkill -9 -f "[q]emu-system-x86_64"; rm -f /tmp/vmui-mac.*'
```

## File map

| Path | Role |
|---|---|
| [scripts/boot-mac.sh](../scripts/boot-mac.sh) | The QEMU command line. Synced into `~/OSX-KVM/` on every launch. |
| [scripts/run-mac-foreground.sh](../scripts/run-mac-foreground.sh) | WSL-side runner; the foreground process whose lifetime gates QEMU. |
| [scripts/watchdog-mac.ps1](../scripts/watchdog-mac.ps1) | Windows-side restart loop; holds the WSL handle. |
| [scripts/spawn-watchdog.ps1](../scripts/spawn-watchdog.ps1) | Detached launcher used by the web UI Server Action. |
| [src/lib/providers/local-kvm.ts](../src/lib/providers/local-kvm.ts) | `LocalKvmProvider` (verify, list, start, stop, stats, QMP). |
