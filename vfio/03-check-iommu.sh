#!/usr/bin/env bash
# Step 3 — verify the host is genuinely ready. Run after rebooting.
#
# This is a gate, not a formality. The usual failure is an IOMMU group that
# contains the GPU *and* unrelated devices: VFIO can only pass a whole group,
# so you would be handing the guest your USB controller or NVMe as well.
# Finding that out now is much cheaper than finding out mid-install.
set -u

pass() { printf '\033[32m  PASS\033[0m  %s\n' "$*"; }
fail() { printf '\033[31m  FAIL\033[0m  %s\n' "$*"; FAILED=1; }
warn() { printf '\033[33m  WARN\033[0m  %s\n' "$*"; }
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
FAILED=0

say "1. IOMMU active"
if dmesg 2>/dev/null | grep -qE 'DMAR: IOMMU enabled|AMD-Vi: Interrupt remapping enabled'; then
  pass "IOMMU is on"
else
  fail "IOMMU not enabled — check VT-d in BIOS and the kernel cmdline"
fi

say "2. IOMMU groups exist"
N=$(ls /sys/kernel/iommu_groups/ 2>/dev/null | wc -l)
if [ "$N" -gt 0 ]; then pass "$N groups"; else fail "no groups — passthrough impossible"; fi

say "3. AMD GPU present"
AMD=$(lspci -nn | grep -Ei 'VGA compatible' | grep -i 'AMD/ATI' || true)
if [ -n "$AMD" ]; then pass "$AMD"; else fail "no AMD GPU found"; fi

if [ -n "$AMD" ]; then
  SLOT=$(echo "$AMD" | cut -d' ' -f1)
  BUS=$(echo "$SLOT" | cut -d. -f1)

  say "4. IOMMU group isolation (the important one)"
  GROUP=""
  for g in /sys/kernel/iommu_groups/*/devices/*; do
    [ -e "$g" ] || continue
    if [[ "$(basename "$g")" == *"$BUS"* ]]; then
      GROUP=$(basename "$(dirname "$(dirname "$g")")"); break
    fi
  done
  if [ -n "$GROUP" ]; then
    echo "  group $GROUP contains:"
    CLEAN=1
    for d in /sys/kernel/iommu_groups/"$GROUP"/devices/*; do
      dev=$(basename "$d"); desc=$(lspci -s "$dev" 2>/dev/null)
      echo "    $desc"
      # Anything that is not the GPU or its own audio/bridge functions is a problem.
      if [[ "$dev" != *"$BUS"* ]] && ! echo "$desc" | grep -qiE 'PCI bridge|Root Port'; then
        CLEAN=0
      fi
    done
    if [ "$CLEAN" = 1 ]; then
      pass "group holds only the GPU and its own functions"
    else
      fail "group contains unrelated devices — you would pass those through too"
      warn "options: move the card to another slot, or apply the ACS override patch"
    fi
  else
    fail "could not determine the GPU's IOMMU group"
  fi

  say "5. bound to vfio-pci"
  DRV=$(lspci -k -s "$SLOT" | awk -F': ' '/Kernel driver in use/{print $2}')
  if [ "${DRV:-}" = "vfio-pci" ]; then
    pass "driver in use: vfio-pci"
  else
    fail "driver in use: ${DRV:-none} (expected vfio-pci)"
    warn "check /etc/modprobe.d/vfio.conf, then update-initramfs -u -k all and reboot"
  fi

  say "6. HDMI audio function also bound"
  AUD=$(lspci -nn -s "$BUS" | grep -i audio || true)
  if [ -n "$AUD" ]; then
    ASLOT=$(echo "$AUD" | cut -d' ' -f1)
    ADRV=$(lspci -k -s "$ASLOT" | awk -F': ' '/Kernel driver in use/{print $2}')
    if [ "${ADRV:-}" = "vfio-pci" ]; then pass "audio function on vfio-pci"
    else warn "audio function uses ${ADRV:-none}; pass it through with the GPU"; fi
  else
    warn "no HDMI audio function found (unusual but not fatal)"
  fi
fi

say "7. host still has its own display"
HOSTGPU=$(lspci -nn | grep -Ei 'VGA compatible' | grep -vi 'AMD/ATI' | head -1)
if [ -n "$HOSTGPU" ]; then pass "host GPU: $HOSTGPU"
else fail "no second GPU — passing the only GPU leaves the host headless"; fi

say "8. KVM usable"
[ -c /dev/kvm ] && pass "/dev/kvm present" || fail "/dev/kvm missing"
if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then pass "current user can use it"
else warn "no access to /dev/kvm — log out and back in for the kvm group"; fi

say "9. OVMF firmware"
ls /usr/share/OVMF/OVMF_CODE*.fd >/dev/null 2>&1 && pass "OVMF installed" \
  || fail "OVMF missing — apt install ovmf"

# --------------------------------------------------------------------------
say "verdict"
if [ "$FAILED" = 0 ]; then
  printf '\033[32m  READY — continue with 04-migrate-image.sh\033[0m\n'
else
  printf '\033[31m  NOT READY — fix the failures above before continuing.\033[0m\n'
  echo "  Do not skip ahead: a bad IOMMU group means passing unintended hardware"
  echo "  to the guest, which typically hangs or corrupts the host."
  exit 1
fi
