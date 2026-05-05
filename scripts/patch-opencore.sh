#!/usr/bin/env bash
# Patches ~/OSX-KVM/OpenCore/OpenCore.qcow2 to enable the boot picker.
set -euo pipefail
IMG="$HOME/OSX-KVM/OpenCore/OpenCore.qcow2"
MNT=/mnt/oc
sudo modprobe nbd 2>/dev/null || sudo insmod /lib/modules/$(uname -r)/kernel/drivers/block/nbd.ko 2>/dev/null || true
sudo qemu-nbd --disconnect /dev/nbd0 2>/dev/null || true
sudo qemu-nbd --connect=/dev/nbd0 "$IMG"
sleep 2
sudo mkdir -p "$MNT"
sudo mount /dev/nbd0p1 "$MNT"
sudo python3 <<'PY'
import plistlib
p = "/mnt/oc/EFI/OC/config.plist"
with open(p, "rb") as f:
    d = plistlib.load(f)
b = d["Misc"].setdefault("Boot", {})
b["ShowPicker"] = True
b["Timeout"] = 10
b["PickerMode"] = "Builtin"
b["PickerAttributes"] = 17
# Hide auxiliary entries (Recovery, Reset NVRAM, UEFI Shell, Tools).
# Press Space at the picker to reveal them when needed.
b["HideAuxiliary"] = True

# Restrict scanning so the OpenCore EFI / installer FAT partitions don't
# show up as "EFI Boot" entries next to Macintosh HD. Internal APFS only:
#   OC_SCAN_FILE_SYSTEM_LOCK | OC_SCAN_DEVICE_LOCK
#   | OC_SCAN_ALLOW_FS_APFS
#   | OC_SCAN_ALLOW_DEVICE_SATA | OC_SCAN_ALLOW_DEVICE_SASEX
#   | OC_SCAN_ALLOW_DEVICE_SCSI | OC_SCAN_ALLOW_DEVICE_NVME
sec = d["Misc"].setdefault("Security", {})
sec["ScanPolicy"] = 0x10F0103
sec["AllowSetDefault"] = True

# Mark every Tools entry as Auxiliary so HideAuxiliary hides them too.
for tool in d["Misc"].get("Tools", []) or []:
    tool["Auxiliary"] = True

# Mark any custom Entries (e.g. "EFI Boot" loaders) as Auxiliary as well.
for entry in d["Misc"].get("Entries", []) or []:
    entry["Auxiliary"] = True

print("Boot dict after patch:")
for k in ("ShowPicker","Timeout","PickerMode","PickerAttributes","HideAuxiliary"):
    print(f"  Boot.{k} = {b.get(k)}")
print(f"  Security.ScanPolicy = {hex(sec['ScanPolicy'])}")
print(f"  Security.AllowSetDefault = {sec['AllowSetDefault']}")
with open(p, "wb") as f:
    plistlib.dump(d, f)
print("WROTE", p)
PY
sudo umount "$MNT"
sudo qemu-nbd --disconnect /dev/nbd0
echo "DONE"
