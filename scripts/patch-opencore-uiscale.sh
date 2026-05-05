#!/bin/bash
# Patch OpenCore.qcow2 to force UIScale=1 (non-HiDPI) inside the EFI partition.
# Why: with the QEMU 1920x1080 EDID, OpenCore's UIScale=0 (Auto) defaults to
# 2x and macOS renders at 960x540 logical → everything looks huge. Setting
# UIScale=1 forces 1x so the UI uses the full 1920x1080 logical points.
#
# Idempotent. Requires the VM to be stopped first.
set -euo pipefail

QCOW="$HOME/OSX-KVM/OpenCore/OpenCore.qcow2"
NBD=/dev/nbd0
MNT=/tmp/vmui-oc-mnt

if pgrep -f qemu-system-x86_64 >/dev/null; then
  echo "ERROR: qemu-system is running; stop the VM first." >&2
  exit 1
fi

cleanup() {
  sudo sync 2>/dev/null || true
  sudo umount "$MNT" 2>/dev/null || sudo umount -l "$MNT" 2>/dev/null || true
  sudo qemu-nbd -d "$NBD" 2>/dev/null || true
  sudo rmdir "$MNT" 2>/dev/null || true
}
trap cleanup EXIT

sudo modprobe nbd >/dev/null 2>&1 || true
sudo mkdir -p "$MNT"
sudo qemu-nbd -d "$NBD" >/dev/null 2>&1 || true
sudo qemu-nbd -c "$NBD" "$QCOW"

# Wait for partitions to settle
for _ in 1 2 3 4 5; do
  if [ -e "${NBD}p1" ]; then break; fi
  sleep 0.3
done

PART="${NBD}p1"
if [ ! -e "$PART" ]; then PART="$NBD"; fi

sudo mount "$PART" "$MNT"

CFG="$MNT/EFI/OC/config.plist"
if [ ! -f "$CFG" ]; then
  echo "ERROR: config.plist not found at $CFG" >&2
  ls -la "$MNT" >&2
  exit 1
fi

# Backup once.
[ -f "$CFG.vmui-bak" ] || sudo cp "$CFG" "$CFG.vmui-bak"

# 1) Set Output > UIScale to 1 (the integer value right after the UIScale key).
#    The plist has it as <key>UIScale</key>\n<integer>0</integer>. We rewrite
#    it to <integer>1</integer>. Use a Python one-liner to keep the XML valid.
sudo python3 - "$CFG" <<'PY'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
s = p.read_text()
new = re.sub(r"(<key>UIScale</key>\s*)<integer>\d+</integer>", r"\1<integer>1</integer>", s, count=1)
if new == s:
    print("WARN: UIScale key not found or already 1", file=sys.stderr)
p.write_text(new)
print("UIScale key patched")
PY

# 2) Bake UIScale=01 into the NVRAM Add section under BOTH Apple boot-args
#    GUIDs (UIScale lives under 4D1EDE05-... in macOS practice; we set both
#    to be safe). OpenCore won't overwrite an existing NVRAM variable from
#    `Add` unless the same key is also listed in `Delete`, so we add it to both.
#    Also set Misc.Boot.Timeout to a short value so the picker auto-boots
#    Macintosh HD quickly when it's the only macOS entry.
sudo python3 - "$CFG" <<'PY'
import sys, pathlib, plistlib
p = pathlib.Path(sys.argv[1])
with p.open("rb") as f:
    plist = plistlib.load(f)

GUIDS = [
    "4D1EDE05-38C7-4A6A-9CC6-4BCCA8B38C14",   # Apple Boot Variables (where macOS reads UIScale)
    "4D1FDA02-38C7-4A6A-9CC6-4BCCA8B30102",   # Apple Vendor Variables (belt-and-braces)
]
nvram = plist.setdefault("NVRAM", {})
add = nvram.setdefault("Add", {})
delete = nvram.setdefault("Delete", {})
for guid in GUIDS:
    add.setdefault(guid, {})["UIScale"] = b"\x01"
    dl = delete.setdefault(guid, [])
    if "UIScale" not in dl:
        dl.append("UIScale")

nvram["WriteFlash"] = True
nvram["LegacyOverwrite"] = True

# Boot picker behaviour: 3s timeout, hide aux/EFI tools, allow saving the
# last-booted entry as default so subsequent boots are even faster.
boot = plist.setdefault("Misc", {}).setdefault("Boot", {})
boot["Timeout"] = 3
boot["HideAuxiliary"] = True
boot["ShowPicker"] = True
sec = plist.setdefault("Misc", {}).setdefault("Security", {})
sec["AllowSetDefault"] = True

with p.open("wb") as f:
    plistlib.dump(plist, f)
print("NVRAM UIScale=01 + boot timeout=3 + AllowSetDefault=True written")
PY

sync
echo "OK: OpenCore patched. Restart the VM."
