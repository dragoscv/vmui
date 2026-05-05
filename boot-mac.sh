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
NAME="${VM_NAME:-vmui-mac}"

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
  -audiodev none,id=noaudio \
  -device ich9-intel-hda -device hda-duplex,audiodev=noaudio \
  -device ich9-ahci,id=sata \
  -drive id=OpenCoreBoot,if=none,snapshot=on,format=qcow2,file="OpenCore/OpenCore.qcow2" \
  -device ide-hd,bus=sata.2,drive=OpenCoreBoot \
  -drive id=InstallMedia,if=none,file="BaseSystem.img",format=raw \
  -device ide-hd,bus=sata.3,drive=InstallMedia \
  -drive id=MacHDD,if=none,file="mac_hdd_ng.img",format=qcow2 \
  -device ide-hd,bus=sata.4,drive=MacHDD \
  -netdev user,id=net0,hostfwd=tcp::"$SSH_FORWARD_PORT"-:22 \
  -device vmxnet3,netdev=net0,id=net0,mac=52:54:00:c9:18:27 \
  -monitor stdio \
  -vnc "0.0.0.0:$VNC_PORT" \
  -qmp tcp:127.0.0.1:"$QMP_PORT",server=on,wait=off \
  -no-reboot \
  -d guest_errors -D /tmp/vmui-mac.qemu.log \
  -pidfile /tmp/vmui-mac.pid
