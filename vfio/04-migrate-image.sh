#!/usr/bin/env bash
# Step 4 — move the existing macOS install to the bare-metal host.
#
# Reuses the Tahoe 26.6.2 guest that already works instead of reinstalling:
# ~40 minutes of copying versus several hours of setup.
#
# The overlay chain (mac-tahoe.qcow2 -> mac_hdd_ng.img) must be flattened,
# because the backing file lives inside WSL2 and would not follow.
#
#   bash 04-migrate-image.sh /path/to/source /path/to/dest
set -euo pipefail

SRC="${1:-}"
DST="${2:-/var/lib/libvirt/images}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m  ERROR: %s\033[0m\n' "$*" >&2; exit 1; }

if [ -z "$SRC" ]; then
  cat <<'USAGE'
usage: 04-migrate-image.sh <source> [dest-dir]

Getting the image out of WSL2 first, from Windows PowerShell:

    wsl -d Ubuntu-24.04 -- bash -lc '
      cd /home/dragos/OSX-KVM
      qemu-img convert -p -O qcow2 -c mac-tahoe.qcow2 /mnt/h/mac-tahoe-flat.qcow2'

  -c compresses (49 GB -> roughly 20 GB) and flattens the overlay chain in one
  pass. Write it to a drive the Linux host can also read (H: has 1138 GB free).

Then, on the Linux host:

    bash 04-migrate-image.sh /mnt/h/mac-tahoe-flat.qcow2

You also need OpenCore.qcow2 from the same directory — it is the bootloader.
USAGE
  exit 0
fi

[ -f "$SRC" ] || die "not found: $SRC"

say "source"
qemu-img info "$SRC" | sed 's/^/  /'

say "checking for a backing file"
BACKING=$(qemu-img info --output=json "$SRC" | grep -o '"backing-filename": *"[^"]*"' | cut -d'"' -f4 || true)
if [ -n "$BACKING" ]; then
  die "this image still has a backing file: $BACKING
  Flatten it first:  qemu-img convert -p -O qcow2 '$SRC' flat.qcow2"
fi
echo "  standalone — good"

say "integrity"
qemu-img check "$SRC" 2>&1 | tail -3 | sed 's/^/  /'

say "copying to $DST"
mkdir -p "$DST"
install -m 0660 -o "$(id -u)" -g kvm "$SRC" "$DST/macos-tahoe.qcow2" 2>/dev/null \
  || cp "$SRC" "$DST/macos-tahoe.qcow2"
echo "  $DST/macos-tahoe.qcow2"

say "OpenCore bootloader"
OC_SRC="$(dirname "$SRC")/OpenCore.qcow2"
if [ -f "$OC_SRC" ]; then
  cp "$OC_SRC" "$DST/OpenCore.qcow2"
  echo "  copied"
else
  echo "  NOT FOUND next to the disk image."
  echo "  Copy it from WSL2: /home/dragos/OSX-KVM/OpenCore/OpenCore.qcow2"
  echo "  The VM cannot boot without it."
fi

say "OVMF variables (per-VM copy — never share the template)"
for c in /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/OVMF/OVMF_VARS.fd; do
  [ -f "$c" ] && { cp "$c" "$DST/macos_VARS.fd"; echo "  from $c"; break; }
done
[ -f "$DST/macos_VARS.fd" ] || die "no OVMF_VARS template found — apt install ovmf"

say "permissions"
chown -R libvirt-qemu:kvm "$DST"/macos-tahoe.qcow2 "$DST"/OpenCore.qcow2 "$DST"/macos_VARS.fd 2>/dev/null || true
ls -la "$DST"/macos-tahoe.qcow2 "$DST"/OpenCore.qcow2 "$DST"/macos_VARS.fd 2>/dev/null | sed 's/^/  /'

say "next"
echo "  1. edit 05-macos-vm.xml — set the GPU PCI address from 03-check-iommu.sh"
echo "  2. virsh define 05-macos-vm.xml"
echo "  3. virsh start macos-tahoe"
echo "  4. bash 06-verify-metal.sh"
