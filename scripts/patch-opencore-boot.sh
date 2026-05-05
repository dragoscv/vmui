#!/usr/bin/env bash
# Patch ~/OSX-KVM/OpenCore/OpenCore.qcow2 to:
#   - Hide the auxiliary "EFI" entry from the picker
#   - Auto-boot the default entry after 1s
#   - Allow saving the default (Ctrl+Enter on Macintosh HD persists it)
#   - Force UIScale=1 (already done by patch-opencore-uiscale, idempotent)
#
# Robust against stale qemu-nbd / mount state that has previously hung.
# Requires: VM stopped, sudo (passwordless or running as root).
set -u

QCOW="$HOME/OSX-KVM/OpenCore/OpenCore.qcow2"
NBD=/dev/nbd0
MNT=/tmp/vmui-oc-mnt

# Hard fail if VM still running
if pgrep -f qemu-system-x86_64 >/dev/null; then
  echo "ERROR: qemu-system-x86_64 is running; stop the VM first." >&2
  exit 1
fi

cleanup() {
  sudo sync 2>/dev/null || true
  sudo umount "$MNT" 2>/dev/null || sudo umount -l "$MNT" 2>/dev/null || true
  sudo qemu-nbd -d "$NBD" 2>/dev/null || true
  sudo rmdir "$MNT" 2>/dev/null || true
}
trap cleanup EXIT

# Pre-clean: any stale mount or nbd connection from a previous crashed run
sudo umount -l "$MNT" 2>/dev/null || true
sudo qemu-nbd -d "$NBD" 2>/dev/null || true
sudo modprobe nbd max_part=8 >/dev/null 2>&1 || true
sudo mkdir -p "$MNT"

echo ">> connecting $QCOW to $NBD"
sudo qemu-nbd -c "$NBD" "$QCOW"

# Wait for partition probe
for i in 1 2 3 4 5 6; do
  [ -e "${NBD}p1" ] && break
  sleep 0.4
done

PART="${NBD}p1"
[ -e "$PART" ] || PART="$NBD"

echo ">> mounting $PART"
sudo mount "$PART" "$MNT"

CFG="$MNT/EFI/OC/config.plist"
if [ ! -f "$CFG" ]; then
  echo "ERROR: config.plist not found at $CFG" >&2
  ls -la "$MNT/EFI/OC/" >&2
  exit 1
fi

# One-time backup
[ -f "$CFG.vmui-bak2" ] || sudo cp "$CFG" "$CFG.vmui-bak2"

echo ">> patching $CFG"
sudo /usr/bin/python3 - "$CFG" <<'PY'
import sys, plistlib, pathlib
p = pathlib.Path(sys.argv[1])
with p.open("rb") as f:
    d = plistlib.load(f)

boot = d.setdefault("Misc", {}).setdefault("Boot", {})
boot["HideAuxiliary"]  = True   # hide the EFI shell / aux entries
boot["ShowPicker"]     = True   # leave picker so user can pick once
boot["Timeout"]        = 1      # auto-boot after 1 second
boot["PickerAttributes"] = 17   # allow custom labels / icons

sec = d.setdefault("Misc", {}).setdefault("Security", {})
sec["AllowSetDefault"] = True   # Ctrl+Enter persists the chosen entry

# Ensure UIScale=01 in NVRAM Add (carry-over from previous patch — idempotent)
GUIDS = [
    "4D1EDE05-38C7-4A6A-9CC6-4BCCA8B38C14",
    "4D1FDA02-38C7-4A6A-9CC6-4BCCA8B30102",
]
nvram = d.setdefault("NVRAM", {})
add = nvram.setdefault("Add", {})
delete = nvram.setdefault("Delete", {})
for guid in GUIDS:
    add.setdefault(guid, {})["UIScale"] = b"\x01"
    dl = delete.setdefault(guid, [])
    if "UIScale" not in dl:
        dl.append("UIScale")
nvram["WriteFlash"] = True
nvram["LegacyOverwrite"] = True

with p.open("wb") as f:
    plistlib.dump(d, f)

print("OK: HideAuxiliary=True, Timeout=1, AllowSetDefault=True")
PY

sync
echo ">> done. Boot the VM, press Ctrl+Enter on 'Macintosh HD' to make it permanent default."
