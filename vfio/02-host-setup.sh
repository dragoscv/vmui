#!/usr/bin/env bash
# Step 2 — prepare a bare-metal Linux host for GPU passthrough.
#
# Installs the virtualisation stack, turns on IOMMU, and binds the AMD card to
# vfio-pci at boot so the host driver never claims it.
#
#   sudo bash 02-host-setup.sh            # detect, show the plan, change nothing
#   sudo bash 02-host-setup.sh --apply    # write the config
#
# Written for Ubuntu 24.04 / Debian with GRUB. Fedora/Arch differ in package
# names and initramfs tooling; the IOMMU and vfio-pci logic is the same.
set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m  ERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run with sudo"

# ------------------------------------------------------------------ CPU ---
say "CPU / IOMMU flag"
if grep -q 'GenuineIntel' /proc/cpuinfo; then
  VENDOR=intel; IOMMU_FLAG="intel_iommu=on"
else
  VENDOR=amd;   IOMMU_FLAG="amd_iommu=on"
fi
echo "  vendor: $VENDOR  ->  $IOMMU_FLAG"
grep -qE 'vmx|svm' /proc/cpuinfo || die "no VT-x/AMD-V in /proc/cpuinfo — enable it in BIOS"
echo "  hardware virtualisation: present"

# --------------------------------------------------------------- detect ---
say "GPUs on the PCI bus"
mapfile -t GPUS < <(lspci -nn | grep -Ei 'VGA compatible|3D controller')
for g in "${GPUS[@]}"; do echo "  $g"; done
[ "${#GPUS[@]}" -ge 2 ] || warn "only one GPU found — you need a second card for the host"

say "AMD card to pass through"
AMD_LINE=$(lspci -nn | grep -Ei 'VGA compatible' | grep -i 'AMD/ATI' || true)
if [ -z "$AMD_LINE" ]; then
  warn "no AMD GPU detected. Install the card first (see 01-bios-checklist.md)."
  warn "Continuing in inspection mode so you can see what the script would do."
  GPU_SLOT=""; GPU_IDS=""
else
  echo "  $AMD_LINE"
  GPU_SLOT=$(echo "$AMD_LINE" | cut -d' ' -f1)
  # A GPU is a multi-function device: the HDMI audio function must be passed
  # through too, or macOS may fail to initialise the card.
  DOMAIN_BUS=$(echo "$GPU_SLOT" | cut -d. -f1)
  GPU_IDS=$(lspci -nn -s "$DOMAIN_BUS" | grep -oP '\[\K[0-9a-f]{4}:[0-9a-f]{4}(?=\])' | paste -sd,)
  echo "  slot:        $GPU_SLOT"
  echo "  functions:   $(lspci -s "$DOMAIN_BUS" | wc -l) (video + audio)"
  echo "  vfio ids:    $GPU_IDS"

  # macOS ships drivers only for specific families.
  DEV=$(echo "$AMD_LINE" | grep -oP '\[1002:\K[0-9a-f]{4}')
  case "$DEV" in
    67df|67ef|6fdf) echo "  macOS driver: AMDRadeonX4000.kext (Polaris / RX 470-590) — well supported" ;;
    731f|7340|7341) echo "  macOS driver: AMDRadeonX5000.kext (Navi 10/14) — needs agdpmod=pikera" ;;
    73ff|73e3|73df) echo "  macOS driver: AMDRadeonX6000.kext (Navi 23/22) — Metal 3" ;;
    *) warn "device 1002:$DEV is not a known-good macOS card — verify before relying on it" ;;
  esac
fi

# -------------------------------------------------------------- packages ---
say "virtualisation packages"
PKGS=(qemu-kvm libvirt-daemon-system libvirt-clients virtinst ovmf
      bridge-utils qemu-utils python3-pip pciutils)
MISSING=()
for p in "${PKGS[@]}"; do dpkg -l "$p" &>/dev/null || MISSING+=("$p"); done
if [ "${#MISSING[@]}" -eq 0 ]; then
  echo "  all present"
elif [ "$APPLY" = 1 ]; then
  echo "  installing: ${MISSING[*]}"
  apt-get update -qq && apt-get install -y "${MISSING[@]}"
else
  echo "  would install: ${MISSING[*]}"
fi

# ------------------------------------------------------------- bootloader ---
say "kernel command line"
CMDLINE="$IOMMU_FLAG iommu=pt"
[ -n "$GPU_IDS" ] && CMDLINE="$CMDLINE vfio-pci.ids=$GPU_IDS"
# video=efifb:off stops the host framebuffer from squatting on the passed card.
CMDLINE="$CMDLINE video=efifb:off"
echo "  want: $CMDLINE"

GRUB=/etc/default/grub
if grep -q "$IOMMU_FLAG" "$GRUB" 2>/dev/null; then
  echo "  already configured"
elif [ "$APPLY" = 1 ]; then
  cp "$GRUB" "$GRUB.bak-$(date +%Y%m%d-%H%M%S)"
  sed -i "s|^GRUB_CMDLINE_LINUX_DEFAULT=\"\(.*\)\"|GRUB_CMDLINE_LINUX_DEFAULT=\"\1 $CMDLINE\"|" "$GRUB"
  update-grub
  echo "  written (backup kept alongside)"
else
  echo "  would append to GRUB_CMDLINE_LINUX_DEFAULT"
fi

# ------------------------------------------------------------------ vfio ---
say "vfio-pci binding"
if [ -n "$GPU_IDS" ]; then
  if [ "$APPLY" = 1 ]; then
    printf 'options vfio-pci ids=%s disable_vga=1\n' "$GPU_IDS" > /etc/modprobe.d/vfio.conf
    # Load vfio before amdgpu, otherwise the host driver grabs the card first.
    printf 'softdep amdgpu pre: vfio-pci\nsoftdep radeon pre: vfio-pci\nsoftdep snd_hda_intel pre: vfio-pci\n' \
      > /etc/modprobe.d/vfio-softdep.conf
    printf 'vfio\nvfio_iommu_type1\nvfio_pci\n' > /etc/modules-load.d/vfio.conf
    update-initramfs -u -k all
    echo "  /etc/modprobe.d/vfio.conf written; initramfs rebuilt"
  else
    echo "  would write /etc/modprobe.d/vfio.conf with ids=$GPU_IDS"
    echo "  would add softdep so vfio-pci loads before amdgpu"
  fi
else
  echo "  skipped — no AMD card present yet"
fi

# ----------------------------------------------------------------- libvirt ---
say "libvirt"
if [ "$APPLY" = 1 ]; then
  systemctl enable --now libvirtd
  usermod -aG libvirt,kvm "${SUDO_USER:-$USER}" 2>/dev/null || true
  echo "  enabled; ${SUDO_USER:-$USER} added to libvirt and kvm groups"
else
  echo "  would enable libvirtd and add ${SUDO_USER:-$USER} to libvirt/kvm"
fi

# -------------------------------------------------------------------- next ---
say "next"
if [ "$APPLY" = 1 ]; then
  echo "  1. reboot"
  echo "  2. bash 03-check-iommu.sh   <- verify before going further"
else
  echo "  This was a dry run. Re-run with --apply to write the configuration."
fi
