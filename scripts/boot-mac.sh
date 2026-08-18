#!/usr/bin/env bash
# vmui — boot macOS in QEMU/KVM with VNC + QMP control surface
# Designed for WSL2 Ubuntu; connect from Windows with any VNC client to localhost:5900
set -euo pipefail

cd "$(dirname "$0")"

ALLOCATED_RAM="${ALLOCATED_RAM:-16384}"   # MiB
CPU_SOCKETS="1"
CPU_CORES="${CPU_CORES:-4}"               # macOS works best with <=8 cores; 4 is the sweet spot
CPU_THREADS="${CPU_THREADS:-8}"

VNC_PORT="${VNC_PORT:-0}"                 # QEMU adds 5900; 0 means port 5900
QMP_PORT="${QMP_PORT:-4444}"
SSH_FORWARD_PORT="${SSH_FORWARD_PORT:-10022}"
SPICE_PORT="${SPICE_PORT:-5930}"          # connect with virt-viewer / remote-viewer
ARD_FORWARD_PORT="${ARD_FORWARD_PORT:-5901}"  # host:5901 -> guest:5900 (Apple Screen Sharing)
NAME="${VM_NAME:-vmui-mac}"

# Which macOS system disk to boot.
#
# `mac_hdd_ng.img` is the FROZEN golden base (chmod 444, macOS 15.7.5) and is
# never booted directly — every bootable disk is a qcow2 overlay on top of it,
# so an OS upgrade can be tested and reverted without touching the base.
# Branches are managed with scripts/mac-branch.ps1 (-List / -Use / -Reset).
#
#   mac-tahoe.qcow2   macOS Tahoe 26.6.2 (25G83)   <- default
#   mac-retry.qcow2   macOS Sequoia 15.7.9 (24G830)
#   mac-current.qcow2 macOS Sequoia 15.7.5 (24G624, the original)
MAC_DISK="${MAC_DISK:-mac-tahoe.qcow2}"

# Required by macOS guest
if ! cat /sys/module/kvm/parameters/ignore_msrs 2>/dev/null | grep -q Y; then
  echo 1 | sudo tee /sys/module/kvm/parameters/ignore_msrs >/dev/null || true
fi

MY_OPTIONS="+ssse3,+sse4.2,+popcnt,+avx,+aes,+xsave,+xsaveopt,check"

# This is the EXACT config that successfully booted macOS Sequoia and wrote
# 33 GB before the SSV-sealing pause. Skylake-Client's QEMU CPU definition
# already includes AVX2, BMI1, BMI2, FMA — adding them explicitly is a no-op,
# but adding +xsavec,+xgetbv1 triggers a guest triple-fault on QEMU 6.2.
# -hle,-rtm strip TSX bits Apple's kernel rejects on synthesized CPU models.
CPU="Skylake-Client,-hle,-rtm,kvm=on,vendor=GenuineIntel,+invtsc,vmware-cpuid-freq=on,$MY_OPTIONS"

# We deliberately omit the GUI display and use VNC instead so vmui can connect
# from Windows (WSLg windows don't survive headless server-mode invocations).
# QMP is exposed on a TCP socket for control by vmui.

exec qemu-system-x86_64 \
  -name "$NAME" \
  -enable-kvm -m "$ALLOCATED_RAM" \
  -cpu "$CPU" \
  -machine q35 \
  -smp "$CPU_THREADS",cores="$CPU_CORES",sockets="$CPU_SOCKETS" \
  -device qemu-xhci,id=xhci \
  -device usb-kbd,bus=xhci.0 -device usb-tablet,bus=xhci.0 \
  -device usb-ehci,id=ehci \
  -device isa-applesmc,osk="ourhardworkbythesewordsguardedpleasedontsteal(c)AppleComputerInc" \
  -drive if=pflash,format=raw,readonly=on,file="OVMF_CODE_4M.fd" \
  -drive if=pflash,format=raw,file="OVMF_VARS-1920x1080.fd" \
  -smbios type=2 \
  -audiodev wav,id=audio0,path=/tmp/vmui-mac-audio.wav \
  -device usb-audio,audiodev=audio0,bus=xhci.0,multi=on \
  -device ich9-ahci,id=sata \
  -drive id=OpenCoreBoot,if=none,snapshot=on,format=qcow2,file="OpenCore/OpenCore.qcow2" \
  -device ide-hd,bus=sata.2,drive=OpenCoreBoot \
  -drive id=MacHDD,if=none,file="$MAC_DISK",format=qcow2 \
  -device ide-hd,bus=sata.4,drive=MacHDD \
  -netdev user,id=net0,hostfwd=tcp::"$SSH_FORWARD_PORT"-:22,hostfwd=tcp::"$ARD_FORWARD_PORT"-:5900 \
  -device vmxnet3,netdev=net0,id=net0,mac=52:54:00:c9:18:27 \
  -monitor none \
  -device VGA,edid=on,xres=1920,yres=1080,vgamem_mb=128 \
  -vnc "0.0.0.0:$VNC_PORT" \
  -spice port="$SPICE_PORT",addr=0.0.0.0,disable-ticketing=on,image-compression=auto_glz,jpeg-wan-compression=auto,zlib-glz-wan-compression=auto \
  -device virtio-serial-pci \
  -chardev spicevmc,id=spicechannel0,name=vdagent \
  -device virtserialport,chardev=spicechannel0,name=com.redhat.spice.0 \
  -qmp tcp:127.0.0.1:"$QMP_PORT",server=on,wait=off \
  -no-reboot \
  -d guest_errors -D /tmp/vmui-mac.qemu.log \
  -pidfile /tmp/vmui-mac.pid
