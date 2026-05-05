#!/bin/bash
# Patch ~/OSX-KVM/OpenCore/OpenCore.qcow2 to:
#  - Hide the "EFI Internal Shell" / auxiliary entries from the picker.
#  - Set Timeout=1 so it auto-boots Macintosh HD almost instantly.
#  - Enable AllowSetDefault so the last booted entry is remembered.
#
# Uses qemu-img + mtools (no nbd, no SIP, no host kernel module). Works in
# WSL2 where qemu-nbd hangs.
#
# Idempotent. VM must be stopped before running (we verify).
set -euo pipefail

QCOW="$HOME/OSX-KVM/OpenCore/OpenCore.qcow2"
RAW=/tmp/vmui-oc.raw
WORK=/tmp/vmui-oc-work
EFI_FAT=/tmp/vmui-oc-efi.fat
PLIST_LOCAL="$WORK/config.plist"

if pgrep -f "[q]emu-system-x86_64" >/dev/null; then
  echo "ERROR: qemu-system-x86_64 is running; stop the VM first." >&2
  exit 1
fi

mkdir -p "$WORK"
echo "=== converting qcow2 -> raw ==="
qemu-img convert -O raw "$QCOW" "$RAW"

# Find the EFI System Partition (GPT type C12A7328-...) on the raw image.
# Some OpenCore images are GPT, some MBR; we handle both.
PART_LINE=$(/sbin/sfdisk -d "$RAW" 2>/dev/null | grep -i "C12A7328" | head -1)
if [ -z "$PART_LINE" ]; then
  # Fallback: first partition entry from sfdisk
  PART_LINE=$(/sbin/sfdisk -d "$RAW" 2>/dev/null | grep -E "^/.*\.raw[0-9]+ :" | head -1)
fi
START=$(echo "$PART_LINE" | sed -n 's/.*start=[[:space:]]*\([0-9]*\).*/\1/p')
SECTORS=$(echo "$PART_LINE" | sed -n 's/.*size=[[:space:]]*\([0-9]*\).*/\1/p')
if [ -z "${START:-}" ] || [ -z "${SECTORS:-}" ]; then
  echo "ERROR: could not find FAT partition" >&2
  /sbin/sfdisk -d "$RAW" >&2
  exit 1
fi
OFFSET=$((START * 512))
LEN=$((SECTORS * 512))
echo "FAT partition: offset=$OFFSET bytes, length=$LEN bytes"

echo "=== extracting FAT image ==="
dd if="$RAW" of="$EFI_FAT" bs=512 skip="$START" count="$SECTORS" status=none

echo "=== reading config.plist via mtools ==="
MTOOLSRC=/tmp/vmui-mtoolsrc
cat > "$MTOOLSRC" <<EOF
drive c: file="$EFI_FAT"
EOF
export MTOOLSRC

mcopy -i "$EFI_FAT" -o "::EFI/OC/config.plist" "$PLIST_LOCAL"

echo "=== patching config.plist ==="
/usr/bin/python3 - "$PLIST_LOCAL" <<'PY'
import sys, plistlib, pathlib
p = pathlib.Path(sys.argv[1])
with p.open("rb") as f:
    d = plistlib.load(f)

# --- Misc.Boot: nice OpenCanopy picker, short timeout, auto-pick on timeout ---
boot = d.setdefault("Misc", {}).setdefault("Boot", {})
boot["Timeout"]            = 3       # seconds before auto-booting highlighted entry
boot["ShowPicker"]         = True    # show the picker UI
boot["PickerMode"]         = "External"  # use OpenCanopy.efi (graphical)
boot["PickerVariant"]      = "Auto"
boot["PickerAttributes"]   = 17      # OC_ATTR_USE_VOLUME_ICON|OC_ATTR_USE_POINTER_CONTROL
boot["HideAuxiliary"]      = True    # hide Reset/Shutdown/UEFI Shell behind spacebar
boot["PollAppleHotKeys"]   = False
boot["TakeoffDelay"]       = 0
boot["LauncherOption"]     = "Disabled"
boot["LauncherPath"]       = "Default"

# --- Misc.Security ---
sec = d.setdefault("Misc", {}).setdefault("Security", {})
sec["AllowSetDefault"]     = True    # CTRL+ENTER persists chosen entry as default
# ScanPolicy: APFS + HFS on SATA/USB/NVMe; *no* generic ESP/FAT entries
# OC_SCAN_FILE_SYSTEM_LOCK(1) | OC_SCAN_DEVICE_LOCK(2)
# | OC_SCAN_ALLOW_FS_APFS(0x100) | OC_SCAN_ALLOW_FS_HFS(0x200)
# | OC_SCAN_ALLOW_DEVICE_SATA(0x10000) | OC_SCAN_ALLOW_DEVICE_NVME(0x80000)
# | OC_SCAN_ALLOW_DEVICE_USB(0x200000)
sec["ScanPolicy"]          = 0x290303
sec["BootProtect"]         = "None"  # Bootstrap can confuse fresh installs

# --- UEFI.Drivers: ensure OpenCanopy.efi is loaded for the GUI picker ---
uefi = d.setdefault("UEFI", {})
drivers = uefi.setdefault("Drivers", [])
def has_driver(name):
    for entry in drivers:
        if isinstance(entry, dict):
            if entry.get("Path", "").lower() == name.lower():
                return True
        elif isinstance(entry, str):
            if entry.lower() == name.lower():
                return True
    return False

# Required runtime + GUI picker drivers
required = [
    "OpenRuntime.efi",
    "OpenCanopy.efi",
    "OpenHfsPlus.efi",
    "ResetNvramEntry.efi",
    "ToggleSipEntry.efi",
    "OpenPartitionDxe.efi",
]
# Detect format used (modern OpenCore uses dict entries)
use_dict = drivers and isinstance(drivers[0], dict)
for name in required:
    if has_driver(name):
        continue
    if use_dict:
        drivers.append({
            "Arguments": "",
            "Comment": f"Auto-added by vmui patch ({name})",
            "Enabled": True,
            "LoadEarly": False,
            "Path": name,
        })
    else:
        drivers.append(name)

# Make sure OpenCanopy entry (if it existed) is enabled
for entry in drivers:
    if isinstance(entry, dict) and entry.get("Path", "").lower() == "opencanopy.efi":
        entry["Enabled"] = True

with p.open("wb") as f:
    plistlib.dump(d, f)

print("Patched config.plist:")
print(f"  Misc.Boot.Timeout      = {boot['Timeout']}")
print(f"  Misc.Boot.ShowPicker   = {boot['ShowPicker']}")
print(f"  Misc.Boot.PickerMode   = {boot['PickerMode']}")
print(f"  Misc.Boot.HideAuxiliary= {boot['HideAuxiliary']}")
print(f"  Misc.Security.ScanPolicy   = 0x{sec['ScanPolicy']:X}")
print(f"  Misc.Security.AllowSetDefault = {sec['AllowSetDefault']}")
print(f"  UEFI.Drivers count = {len(drivers)}")
PY

echo "=== writing config.plist back ==="
mcopy -i "$EFI_FAT" -o "$PLIST_LOCAL" "::EFI/OC/config.plist"

echo "=== writing FAT image back into raw ==="
dd if="$EFI_FAT" of="$RAW" bs=512 seek="$START" count="$SECTORS" conv=notrunc status=none

echo "=== converting raw -> qcow2 (replacing original) ==="
qemu-img convert -O qcow2 "$RAW" "$QCOW.new"
mv "$QCOW.new" "$QCOW"

echo "=== cleanup ==="
rm -f "$RAW" "$EFI_FAT" "$PLIST_LOCAL" "$MTOOLSRC"
rmdir "$WORK" 2>/dev/null || true

echo "OK: OpenCore patched. Restart the VM."
