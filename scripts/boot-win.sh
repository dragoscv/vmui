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
# Prefer the repacked install ISO (no "press any key" prompt, autounattend.xml
# embedded at the root). Fall back to the raw Win11-Enterprise.iso /
# Win11.iso plus the sidecar autounattend.iso ONLY if the repack hasn't
# been run yet (this fallback path will hang on the "press any key" prompt;
# always prefer the repacked image).
if [ -f Win11-auto.iso ]; then
  INSTALL_ISO="${INSTALL_ISO:-Win11-auto.iso}"
  USE_SIDECAR_UNATTEND=0
elif [ -f Win11-Enterprise.iso ]; then
  INSTALL_ISO="${INSTALL_ISO:-Win11-Enterprise.iso}"
  USE_SIDECAR_UNATTEND=1
else
  INSTALL_ISO="${INSTALL_ISO:-Win11.iso}"
  USE_SIDECAR_UNATTEND=1
fi
VIRTIO_ISO="${VIRTIO_ISO:-virtio-win.iso}"
UNATTEND_ISO="${UNATTEND_ISO:-autounattend.iso}"
# Use the NON-secboot OVMF firmware. We deliberately do NOT use the
# Microsoft-keyed Secure Boot variant: when the guest sees Secure Boot +
# TPM 2.0, Windows 11 auto-enables VBS/HVCI (Memory Integrity) during early
# kernel boot and tries to set CR4.VMXE to start its inner Hyper-V. Under
# WSL2 (Hyper-V is already L1) this triggers an EPT misconfig (VM-exit
# reason 0x31) and the guest dies before Setup can run. Booting with the
# plain OVMF (no SB, no TPM) keeps VBS dormant; our autounattend.xml has
# BypassTPMCheck/BypassSecureBootCheck flags so Setup is happy regardless.
OVMF_CODE="${OVMF_CODE:-OVMF_CODE.fd}"
OVMF_VARS="${OVMF_VARS:-OVMF_VARS.fd}"

echo "[boot-win] install media: $INSTALL_ISO (sidecar unattend=$USE_SIDECAR_UNATTEND)"

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

# NOTE: swtpm intentionally NOT started. See OVMF comment above re: VBS.

# Build the variable list of CD drives we attach. The unattend ISO must come
# last with bootindex>1 so Windows Setup picks up autounattend.xml from one of
# the attached drives (it scans them all).
#
# q35's built-in AHCI controller exposes 6 SATA ports (ide.0 .. ide.5), each
# holding exactly one unit. We must therefore pin each ide-cd to its own bus
# or QEMU fails with "Can't create IDE unit 1, bus supports only 1 units".
#
# After the first install pass, the disk grows past ~1 GiB (Windows file copy
# is well underway). On subsequent QEMU restarts (the watchdog relaunches us
# whenever the guest reboots, which Windows Setup does several times during
# install) we DETACH the install media so UEFI can no longer fall back to it.
# Otherwise we'd loop forever between "boot installed Windows" → reboot → CD
# is still ahead → install starts from scratch.
DISK_BYTES=0
if [ -f "$DISK" ]; then
  DISK_BYTES="$(stat -c %s "$DISK" 2>/dev/null || echo 0)"
fi
ATTACH_INSTALLER=1
if [ "$DISK_BYTES" -gt $((1 * 1024 * 1024 * 1024)) ]; then
  ATTACH_INSTALLER=0
  echo "[boot-win] disk has $DISK_BYTES bytes already — skipping install media"
fi

CD_ARGS=()
CD_BUS=0
if [ "$ATTACH_INSTALLER" = "1" ] && [ -f "$INSTALL_ISO" ]; then
  CD_ARGS+=("-drive" "file=$INSTALL_ISO,media=cdrom,if=none,id=installcd,readonly=on")
  CD_ARGS+=("-device" "ide-cd,drive=installcd,bus=ide.$CD_BUS,bootindex=2")
  CD_BUS=$((CD_BUS + 1))
fi
if [ "$ATTACH_INSTALLER" = "1" ] && [ -f "$VIRTIO_ISO" ]; then
  CD_ARGS+=("-drive" "file=$VIRTIO_ISO,media=cdrom,if=none,id=virtiocd,readonly=on")
  CD_ARGS+=("-device" "ide-cd,drive=virtiocd,bus=ide.$CD_BUS,bootindex=3")
  CD_BUS=$((CD_BUS + 1))
fi
if [ "$ATTACH_INSTALLER" = "1" ] && [ "$USE_SIDECAR_UNATTEND" = "1" ] && [ -f "$UNATTEND_ISO" ]; then
  CD_ARGS+=("-drive" "file=$UNATTEND_ISO,media=cdrom,if=none,id=unattendcd,readonly=on")
  CD_ARGS+=("-device" "ide-cd,drive=unattendcd,bus=ide.$CD_BUS,bootindex=4")
  CD_BUS=$((CD_BUS + 1))
fi

# When falling back to a non-repacked install ISO (Win11.iso /
# Win11-Enterprise.iso) the UEFI bootloader shows "Press any key to boot
# from CD or DVD..." for ~5 s. To keep the install hands-off in that case
# we fork a background helper that hammers ENTER on PS/2 and USB keyboards
# via QMP for ~60 s. With Win11-auto.iso this isn't needed because the EFI
# El-Torito boot image is the no-prompt variant.
if [ "$USE_SIDECAR_UNATTEND" = "1" ]; then
  (
    exec >/tmp/vmui-win-keypress.log 2>&1
    echo "[$(date)] keypress helper start (qmp 127.0.0.1:$QMP_PORT)"
    for _ in $(seq 1 30); do
      if printf '{"execute":"qmp_capabilities"}\n' \
           | nc -q 1 -w 1 127.0.0.1 "$QMP_PORT" 2>/dev/null | grep -q return; then
        break
      fi
      sleep 0.5
    done
    echo "[$(date)] qmp reachable, hammering keys for 60 s"
    for i in $(seq 1 60); do
      {
        printf '{"execute":"qmp_capabilities"}\n'
        printf '{"execute":"human-monitor-command","arguments":{"command-line":"sendkey ret"}}\n'
        printf '{"execute":"human-monitor-command","arguments":{"command-line":"sendkey spc"}}\n'
        printf '{"execute":"send-key","arguments":{"keys":[{"type":"qcode","data":"ret"}],"hold-time":100}}\n'
      } | nc -q 1 -w 2 127.0.0.1 "$QMP_PORT" >/dev/null 2>&1 || true
      sleep 1
    done
    echo "[$(date)] keypress helper done"
  ) &
fi

# CPU model selection — running Windows as an L3 guest:
#   L0 host (Windows) -> L1 Hyper-V -> L2 WSL2 (Linux) -> L3 QEMU/KVM (Windows).
#
# `-cpu host` (with or without hv-passthrough) causes
# `KVM: entry failed, hardware error 0x0` on the first Windows-kernel
# VMENTER under WSL2 because the WSL kernel running on Hyper-V cannot back
# every CR4 control bit / MSR that `host` exposes (notably some PMU and
# SPEC_CTRL bits). The fix is to use a NAMED CPU model whose VMCS state KVM
# can fully express in nested mode. Skylake-Client-v3 is the modern
# recommendation: it advertises everything Win11 requires (SSE4.2, AES,
# SMEP, SMAP, FSGSBASE, RDRAND, XSAVE, AVX, AVX2) without any feature that
# WSL2's L1 hypervisor refuses to virtualise.
#
# Hyper-V enlightenments — minimum-viable curated set that survives nested
# VMENTER on WSL2:
#   hv-relaxed   – relaxes Windows' watchdog timeout (avoids 0x101 BSOD)
#   hv-vapic     – synthetic APIC (faster IPIs, L1-safe)
#   hv-spinlocks – tells Windows to back off rather than VMEXIT-spin
#   hv-time      – synthetic reference-counter pages
#   hv-vpindex   – per-vCPU virtual processor indices
# We deliberately AVOID hv-synic, hv-stimer, hv-tlbflush, hv-ipi: those
# require the L1 hypervisor to back them and trigger invalid-VMCS aborts on
# Hyper-V -> KVM nested setups. `kvm=off,hv-vendor-id=KVMKVMKVM` keeps the
# KVM signature out of CPUID so Windows takes the HV path we wired above
# rather than its KVM-detection path (which assumes Linux-host semantics).
#
# `smm=on` and the secure pflash are needed for Secure Boot to be effective.
exec qemu-system-x86_64 \
  -name "$NAME" \
  -enable-kvm -m "$ALLOCATED_RAM" \
  -cpu Skylake-Client-v3,kvm=off,hv-vendor-id=KVMKVMKVM,hv-relaxed,hv-vapic,hv-spinlocks=0x1fff,hv-time,hv-vpindex,+aes,+xsave,+xsaveopt,+xsavec,+xgetbv1,+rdrand,+rdseed,+invtsc \
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
  -vga std \
  -display none \
  -vnc "0.0.0.0:$VNC_PORT" \
  -monitor none \
  -qmp tcp:127.0.0.1:"$QMP_PORT",server=on,wait=off \
  -d guest_errors -D /tmp/vmui-win.qemu.log \
  -pidfile /tmp/vmui-win.pid
