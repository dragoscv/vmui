# Local KVM Ubuntu — operations & setup

This document covers the **local-kvm** provider configured with
`kind=ubuntu`: an Ubuntu LTS desktop guest running under QEMU/KVM inside
WSL2 Ubuntu, with a NoCloud cloud-init seed that bakes in `dragos:<your-guest-password>`
as a sudo-NOPASSWD user.

## Network ports (host-side)

| Port  | Purpose                                        |
| ----- | ---------------------------------------------- |
| 7900  | VNC (display console)                          |
| 10024 | SSH (forwarded to guest :22)                   |
| 4446  | QMP (vmui control plane)                       |
| 6100  | noVNC websocket bridge (optional)              |

All ports are on `127.0.0.1` (auto-forwarded from WSL2 to Windows).

## Default credentials

Baked into the cloud-init seed (`seed.iso`):

- Username: `dragos`
- Password: `<your-guest-password>` (stored as SHA-512 crypt hash; cloud-init refuses
  plaintext)
- `sudo NOPASSWD:ALL` for `dragos`
- OpenSSH server installed and enabled
- Default boot target: `graphical.target`

## First-time setup

```pwsh
# From the vmui repo root:
wsl -d Ubuntu-24.04 -- bash /mnt/e/gh/vmui/scripts/setup-ubuntu-vm.sh
```

This script (idempotent) does the following:

1. Installs `qemu-system-x86`, `qemu-utils`, `ovmf`, `genisoimage`,
   `whois` (for `mkpasswd`).
2. Creates `~/vmui-vms/ubuntu/` and copies UEFI firmware:
   - `OVMF_CODE.fd`
   - `OVMF_VARS.fd`
3. Creates a 50 GiB sparse `Ubuntu.qcow2`.
4. Downloads the **Ubuntu 26.04 LTS** ("Resolute Raccoon", released
   2026-04-23) desktop ISO from
   `https://releases.ubuntu.com/26.04/ubuntu-26.04-desktop-amd64.iso`.
   Override with `UBUNTU_RELEASE` or `UBUNTU_ISO_URL` env vars.
5. Generates `seed.iso` with the **NoCloud** cloud-init datasource
   (volume label = `CIDATA`):
   - `meta-data` with `instance-id` + hostname
   - `user-data` with the Subiquity `autoinstall:` schema, including:
     - `interactive-sections: []` (fully unattended)
     - SHA-512 hashed password
     - `ssh.install-server: true` + `allow-pw: true`
     - Late commands: drop a sudoers fragment for NOPASSWD, set graphical
       boot target.

The Ubuntu Desktop installer (24.04 and newer) honors `autoinstall` via the
NoCloud datasource — when the seed.iso is attached, the installer runs
unattended (~10 minutes on first boot).

## Starting the VM

```pwsh
# VS Code task:
Tasks: Run Task → vmui: start ubuntu VM

# Or manually:
.\scripts\spawn-watchdog.ps1 -Distro Ubuntu-24.04 -Kind ubuntu `
  -AllocatedRamMb 4096 -Cores 2 -Threads 4 `
  -VncDisplay 2000 -QmpPort 4446 -SshPort 10024
```

## Connecting

- **VNC**: any client → `127.0.0.1:7900`. Full GUI via virtio-vga.
- **SSH**: `ssh -p 10024 dragos@127.0.0.1` (password: `<your-guest-password>`).

## Stopping

- VS Code task `vmui: stop ubuntu VM`.
- From the UI: `Instances → local-ubuntu → Stop` (graceful — sends
  `system_powerdown` via QMP first, falls back to SIGKILL).

## Post-install

After the autoinstall finishes, the VM reboots. The installer ISO is still
attached but the boot order prefers the disk (bootindex=1 on virtio-blk).
You can detach `ubuntu.iso` to save a few MB of QEMU mmap by editing
`~/vmui-vms/ubuntu/boot-ubuntu.sh` (or simply leave it).

## Files

- `scripts/setup-ubuntu-vm.sh` — one-time setup
- `scripts/boot-ubuntu.sh` — QEMU launcher
- `scripts/run-vm-foreground.sh` — generic foreground runner (`KIND=ubuntu`)
- `scripts/watchdog-vm.ps1` — generic watchdog (`-Kind ubuntu`)
