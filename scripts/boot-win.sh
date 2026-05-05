#!/usr/bin/env bash
# vmui — boot Windows 11 (25H2 by default) in QEMU/KVM with VNC + QMP.
#
# Designed for WSL2 Ubuntu. Connect from Windows host with any VNC client
# to localhost:6900 (default), or use the in-browser noVNC viewer in vmui.
#
# Requirements (installed by setup-win-vm.sh):
#   - qemu-system-x86 + qemu-utils
#   - ovmf (with OVMF_CODE_4M.secboot.fd + OVMF_VARS_4M.ms.fd — Microsoft keys)
#   - swtpm + swtpm-tools (TPM 2.0 emulator — Win11 hard requirement)
#   - genisoimage (or xorriso) for the autounattend ISO
#
# Disk layout in $VMDIR (default ~/vmui-vms/win):
#   Win11.qcow2          — main system disk (created by setup script)
#   Win11.iso            — Windows 11 install ISO (user-supplied; ignored if missing)
#   virtio-win.iso       — VirtIO drivers (downloaded by setup script)
#   autounattend.iso     — ISO containing autounattend.xml (built by setup script)
#   OVMF_CODE.secboot.fd — UEFI firmware (secure boot enabled)
#   OVMF_VARS.fd         — per-VM UEFI variable store (with MS keys preloaded)
#   tpm/                 — swtpm state directory
set -euo pipefail

cd "$(dirname "$0")"

ALLOCATED_RAM="${ALLOCATED_RAM:-8192}"          # MiB
CPU_SOCKETS="${CPU_SOCKETS:-1}"
CPU_CORES="${CPU_CORES:-4}"
CPU_THREADS="${CPU_THREADS:-8}"

# QEMU adds 5900 to the VNC display number. 1000 → host port 6900.
VNC_PORT="${VNC_PORT:-1000}"
QMP_PORT="${QMP_PORT:-4445}"
SSH_FORWARD_PORT="${SSH_FORWARD_PORT:-10023}"
RDP_FORWARD_PORT="${RDP_FORWARD_PORT:-13389}"

NAME="${VM_NAME:-vmui-win}"
DISK="${WIN_DISK:-Win11.qcow2}"
INSTALL_ISO="${INSTALL_ISO:-Win11.iso}"
VIRTIO_ISO="${VIRTIO_ISO:-virtio-win.iso}"
UNATTEND_ISO="${UNATTEND_ISO:-autounattend.iso}"
OVMF_CODE="${OVMF_CODE:-OVMF_CODE.secboot.fd}"
OVMF_VARS="${OVMF_VARS:-OVMF_VARS.fd}"

SWTPM_DIR="./tpm"
SWTPM_SOCK="$SWTPM_DIR/swtpm-sock"

if [ ! -f "$DISK" ]; then
  echo "ERROR: $DISK not found in $(pwd)." >&2
  echo "Run scripts/setup-win-vm.sh first." >&2
  exit 1
fi
if [ ! -f "$OVMF_CODE" ] || [ ! -f "$OVMF_VARS" ]; then
  echo "ERROR: OVMF firmware missing ($OVMF_CODE / $OVMF_VARS)." >&2
  echo "Run scripts/setup-win-vm.sh to copy them from /usr/share/OVMF." >&2
  exit 1
fi

# Start (or restart) the swtpm emulator, daemonized. We bind it to a UNIX
# socket QEMU connects to via -chardev socket,id=chrtpm.
mkdir -p "$SWTPM_DIR"
if ! pgrep -f "swtpm.*$SWTPM_SOCK" >/dev/null 2>&1; then
  rm -f "$SWTPM_SOCK"
  swtpm socket \
    --tpmstate "dir=$SWTPM_DIR" \
    --ctrl "type=unixio,path=$SWTPM_SOCK" \
    --tpm2 \
    --log "level=1,file=/tmp/vmui-win-swtpm.log" \
    --daemon
  # Give it a moment to bind the socket.
  for _ in 1 2 3 4 5; do
    [ -S "$SWTPM_SOCK" ] && break
    sleep 0.2
  done
fi

# Build the variable list of CD drives we attach. The unattend ISO must come
# last with bootindex>1 so Windows Setup picks up autounattend.xml from one of
# the attached drives (it scans them all).
CD_ARGS=()
if [ -f "$INSTALL_ISO" ]; then
  CD_ARGS+=("-drive" "file=$INSTALL_ISO,media=cdrom,if=none,id=installcd,readonly=on")
  CD_ARGS+=("-device" "ide-cd,drive=installcd,bootindex=0")
fi
if [ -f "$VIRTIO_ISO" ]; then
  CD_ARGS+=("-drive" "file=$VIRTIO_ISO,media=cdrom,if=none,id=virtiocd,readonly=on")
  CD_ARGS+=("-device" "ide-cd,drive=virtiocd,bootindex=2")
fi
if [ -f "$UNATTEND_ISO" ]; then
  CD_ARGS+=("-drive" "file=$UNATTEND_ISO,media=cdrom,if=none,id=unattendcd,readonly=on")
  CD_ARGS+=("-device" "ide-cd,drive=unattendcd,bootindex=3")
fi

# Hyper-V enlightenments dramatically improve Windows guest performance.
# `smm=on` and the secure pflash are needed for Secure Boot to be effective.
exec qemu-system-x86_64 \
  -name "$NAME" \
  -enable-kvm -m "$ALLOCATED_RAM" \
  -cpu host,hv_relaxed,hv_spinlocks=0x1fff,hv_vapic,hv_time,hv_vendor_id=KVMKVMKVM,kvm=on \
  -machine q35,smm=on,vmport=off \
  -global driver=cfi.pflash01,property=secure,value=on \
  -global ICH9-LPC.disable_s3=1 \
  -smp "$CPU_THREADS",cores="$CPU_CORES",sockets="$CPU_SOCKETS" \
  -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE" \
  -drive if=pflash,format=raw,file="$OVMF_VARS" \
  -chardev socket,id=chrtpm,path="$SWTPM_SOCK" \
  -tpmdev emulator,id=tpm0,chardev=chrtpm \
  -device tpm-crb,tpmdev=tpm0 \
  -device qemu-xhci,id=xhci \
  -device usb-tablet,bus=xhci.0 \
  -device usb-kbd,bus=xhci.0 \
  -drive file="$DISK",if=none,id=disk0,format=qcow2,cache=writeback,discard=unmap \
  -device virtio-blk-pci,drive=disk0,bootindex=1 \
  "${CD_ARGS[@]}" \
  -netdev user,id=net0,hostfwd=tcp::"$SSH_FORWARD_PORT"-:22,hostfwd=tcp::"$RDP_FORWARD_PORT"-:3389 \
  -device virtio-net-pci,netdev=net0,id=net0,mac=52:54:00:c9:18:28 \
  -vga virtio \
  -display none \
  -vnc "0.0.0.0:$VNC_PORT" \
  -monitor none \
  -qmp tcp:127.0.0.1:"$QMP_PORT",server=on,wait=off \
  -no-reboot \
  -d guest_errors -D /tmp/vmui-win.qemu.log \
  -pidfile /tmp/vmui-win.pid
