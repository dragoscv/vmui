#!/usr/bin/env bash
# vmui — boot Ubuntu (26.04 LTS by default) in QEMU/KVM with VNC + QMP.
#
# Connect from Windows host with any VNC client to localhost:7900 (default).
# Default credentials baked into the cloud-init seed: dragos / REDACTED_GUEST_PASSWORD.
#
# Disk layout in $VMDIR (default ~/vmui-vms/ubuntu):
#   Ubuntu.qcow2     — main system disk (created by setup script)
#   ubuntu.iso       — Ubuntu installer ISO (downloaded by setup script)
#   seed.iso         — NoCloud cloud-init datasource (built by setup script)
#   OVMF_CODE.fd     — UEFI firmware (no secure boot needed for Ubuntu)
#   OVMF_VARS.fd     — per-VM UEFI variable store
set -euo pipefail

cd "$(dirname "$0")"

ALLOCATED_RAM="${ALLOCATED_RAM:-4096}"
CPU_SOCKETS="${CPU_SOCKETS:-1}"
CPU_CORES="${CPU_CORES:-2}"
CPU_THREADS="${CPU_THREADS:-4}"

# QEMU adds 5900 to display. 2000 → host 7900.
VNC_PORT="${VNC_PORT:-2000}"
QMP_PORT="${QMP_PORT:-4446}"
SSH_FORWARD_PORT="${SSH_FORWARD_PORT:-10024}"

NAME="${VM_NAME:-vmui-ubuntu}"
DISK="${UBUNTU_DISK:-Ubuntu.qcow2}"
INSTALL_ISO="${INSTALL_ISO:-ubuntu.iso}"
SEED_ISO="${SEED_ISO:-seed.iso}"
OVMF_CODE="${OVMF_CODE:-OVMF_CODE.fd}"
OVMF_VARS="${OVMF_VARS:-OVMF_VARS.fd}"

if [ ! -f "$DISK" ]; then
  echo "ERROR: $DISK not found in $(pwd)." >&2
  echo "Run scripts/setup-ubuntu-vm.sh first." >&2
  exit 1
fi
if [ ! -f "$OVMF_CODE" ] || [ ! -f "$OVMF_VARS" ]; then
  echo "ERROR: OVMF firmware missing ($OVMF_CODE / $OVMF_VARS)." >&2
  echo "Run scripts/setup-ubuntu-vm.sh to copy them from /usr/share/OVMF." >&2
  exit 1
fi

CD_ARGS=()
if [ -f "$INSTALL_ISO" ]; then
  CD_ARGS+=("-drive" "file=$INSTALL_ISO,media=cdrom,if=none,id=installcd,readonly=on")
  CD_ARGS+=("-device" "ide-cd,drive=installcd,bootindex=0")
fi
if [ -f "$SEED_ISO" ]; then
  CD_ARGS+=("-drive" "file=$SEED_ISO,media=cdrom,if=none,id=seedcd,readonly=on")
  CD_ARGS+=("-device" "ide-cd,drive=seedcd,bootindex=2")
fi

exec qemu-system-x86_64 \
  -name "$NAME" \
  -enable-kvm -m "$ALLOCATED_RAM" \
  -cpu host \
  -machine q35 \
  -smp "$CPU_THREADS",cores="$CPU_CORES",sockets="$CPU_SOCKETS" \
  -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE" \
  -drive if=pflash,format=raw,file="$OVMF_VARS" \
  -device qemu-xhci,id=xhci \
  -device usb-tablet,bus=xhci.0 \
  -device usb-kbd,bus=xhci.0 \
  -drive file="$DISK",if=none,id=disk0,format=qcow2,cache=writeback,discard=unmap \
  -device virtio-blk-pci,drive=disk0,bootindex=1 \
  "${CD_ARGS[@]}" \
  -netdev user,id=net0,hostfwd=tcp::"$SSH_FORWARD_PORT"-:22 \
  -device virtio-net-pci,netdev=net0,id=net0,mac=52:54:00:c9:18:29 \
  -vga virtio \
  -display none \
  -vnc "0.0.0.0:$VNC_PORT" \
  -monitor none \
  -qmp tcp:127.0.0.1:"$QMP_PORT",server=on,wait=off \
  -no-reboot \
  -d guest_errors -D /tmp/vmui-ubuntu.qemu.log \
  -pidfile /tmp/vmui-ubuntu.pid
