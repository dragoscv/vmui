# Local KVM Windows 11 — operations & setup

This document covers the **local-kvm** provider configured with `kind=win`:
a Windows 11 (25H2) guest running under QEMU/KVM inside WSL2 Ubuntu, with
UEFI Secure Boot, emulated TPM 2.0 (swtpm) and an unattended-install ISO
that bakes in `dragos:REDACTED_GUEST_PASSWORD` as the local Administrator.

## Network ports (host-side)

| Port  | Purpose                          |
| ----- | -------------------------------- |
| 6900  | VNC (display console)            |
| 13389 | RDP (forwarded to guest :3389)   |
| 10023 | SSH (forwarded to guest :22, after first logon enables OpenSSH) |
| 4445  | QMP (vmui control plane)         |
| 6090  | noVNC websocket bridge (optional) |

All ports are on `127.0.0.1` (auto-forwarded from WSL2 to Windows).

## Default credentials

Baked into `autounattend.xml`:

- Username: `dragos`
- Password: `REDACTED_GUEST_PASSWORD`
- Local Administrators group
- AutoLogon: 1 (so first-logon commands enable RDP + OpenSSH automatically)

## Architecture

```
 Windows host                                WSL2 (Ubuntu-24.04)
 ─────────────                                ──────────────────
 vmui (Next.js) ──▶ Server Action ──┐
                                    │
       VS Code task ────────────────┼──▶ spawn-watchdog.ps1 (Windows)
                                    │
                                    └──▶ watchdog-vm.ps1 -Kind win (hidden)
                                                │   keeps wsl.exe handle open
                                                ▼
                                          run-vm-foreground.sh (in WSL)
                                                │ KIND=win
                                                ▼
                                          boot-win.sh ──▶ qemu-system-x86_64
                                                              │
                                                              ▼
                                            VNC :6900  RDP :13389  QMP :4445
```

## First-time setup

```pwsh
# From the vmui repo root in PowerShell:
wsl -d Ubuntu-24.04 -- bash /mnt/e/gh/vmui/scripts/setup-win-vm.sh
```

This script (idempotent) does the following:

1. Installs `qemu-system-x86`, `qemu-utils`, `ovmf`, `swtpm`,
   `swtpm-tools`, `genisoimage`, `xorriso`.
2. Creates `~/vmui-vms/win/` and copies UEFI firmware there:
   - `OVMF_CODE.secboot.fd` (Secure Boot enabled)
   - `OVMF_VARS.fd` (Microsoft KEK keys preloaded — no manual enrollment)
3. Creates a 200 GiB sparse `Win11.qcow2` (only consumes actual used space).
4. Downloads the latest stable VirtIO drivers ISO from
   `fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/`.
5. Generates `autounattend.iso` with an `autounattend.xml` that:
   - Bypasses TPM / SecureBoot / RAM / CPU / Storage installer checks
     (belt-and-braces — the host provides real TPM 2.0 + Secure Boot, but
     these registry tweaks make the installer happy on any Win11 build).
   - Wipes disk 0 and writes `EFI + MSR + Windows (NTFS, C:)` partitions.
   - Picks `IMAGE/INDEX = 6` (Pro). Change to 1=Home, 2=Home N, 6=Pro,
     11=Education etc. depending on your ISO edition.
   - Creates the `dragos` local admin with password `REDACTED_GUEST_PASSWORD`.
   - Enables AutoLogon (LogonCount=1) so first-boot can run setup commands.
   - Hides all OOBE / online-account / OEM / EULA / privacy screens.
   - First-logon commands: enable RDP, open Remote Desktop firewall group,
     install OpenSSH server (`OpenSSH.Server~~~~0.0.1.0`), set `sshd` to
     auto-start.

You then need to **drop the official Windows 11 ISO** at:

```
~/vmui-vms/win/Win11.iso
```

Get it from <https://www.microsoft.com/software-download/windows11>
(pick "x64 English"). 25H2 (build 26200+) is the latest stable as of 2026.

## Starting the VM

Three equivalent routes — they all end up running `watchdog-vm.ps1 -Kind win`
with the same parameters.

1. **VS Code task**: `Tasks: Run Task → vmui: start win VM`.
2. **Web UI**: connect a Windows-kind local-kvm account, then click
   `Instances → local-win → Start`.
3. **Manual**:

   ```pwsh
   .\scripts\spawn-watchdog.ps1 -Distro Ubuntu-24.04 -Kind win `
     -AllocatedRamMb 8192 -Cores 4 -Threads 8 `
     -VncDisplay 1000 -QmpPort 4445 -SshPort 10023
   ```

## Connecting

- **VNC**: any client → `127.0.0.1:6900`. The vmui UI also offers an
  in-browser noVNC viewer (start the websockify bridge on port 6090).
- **RDP**: `mstsc /v:127.0.0.1:13389`. Credentials: `dragos / REDACTED_GUEST_PASSWORD`.
- **SSH**: `ssh -p 10023 dragos@127.0.0.1` (after first logon).

## Stopping

- VS Code task `vmui: stop win VM` — kills the watchdog (so it stops
  auto-restarting), sends a hard SIGKILL to QEMU on QMP port 4445, kills
  any orphan `swtpm` processes and removes `/tmp/vmui-win.*`.
- From the UI: `Instances → local-win → Stop` (graceful — sends
  `system_powerdown` via QMP first, falls back to SIGKILL).

## Troubleshooting

### Installer fails with "This PC can't run Windows 11"

This means `autounattend.xml` wasn't picked up. Check:
- The `autounattend.iso` is attached as a CD-ROM (boot-win.sh skips it
  silently if the file isn't there — re-run setup script).
- The file at the volume root is named exactly `autounattend.xml`
  (case-insensitive on FAT/ISO9660 but the build is strict).

### "Boot Manager could not load file" / OVMF reboots in a loop

Almost always Secure Boot DBX/KEK issue. Make sure the `OVMF_VARS.fd` you
copied was the **`.ms.fd`** variant (Microsoft keys preloaded), not a blank
template. The setup script picks the `.ms.fd` automatically when present.

### Black screen after install

VirtIO graphics driver didn't install. After OOBE, open Device Manager →
Display adapters → install drivers from the attached `virtio-win.iso`
(`E:\viogpu\<your_arch>\<win-version>\`).

### swtpm already running

Multiple QEMU launches can leave a stale swtpm. The stop task and the
watchdog preflight both kill orphaned `swtpm` processes; if you have
trouble, run manually:

```bash
wsl -d Ubuntu-24.04 -- pkill -f swtpm
```

## Files

- `scripts/setup-win-vm.sh` — one-time setup
- `scripts/boot-win.sh` — QEMU launcher (synced into VMDIR on each boot)
- `scripts/run-vm-foreground.sh` — generic foreground runner (`KIND=win`)
- `scripts/watchdog-vm.ps1` — generic watchdog (`-Kind win`)
- `scripts/spawn-watchdog.ps1` — Job-Object-breaking spawner
