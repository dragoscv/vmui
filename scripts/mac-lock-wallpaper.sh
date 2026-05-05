#!/bin/bash
# Force the macOS guest's wallpaper to a static black, and lock the prefs file
# so WallpaperAgent cannot overwrite it. Run inside the guest (over SSH).
set -u
P="/Users/dragos/Library/Application Support/com.apple.wallpaper/Store/Index.plist"
chflags nouchg "$P" 2>/dev/null || true
killall WallpaperAgent 2>/dev/null || true
/usr/bin/python3 - <<'PY'
import plistlib, pathlib
p = pathlib.Path("/Users/dragos/Library/Application Support/com.apple.wallpaper/Store/Index.plist")
d = plistlib.loads(p.read_bytes())
NEW = "file:///System/Library/Desktop%20Pictures/Solid%20Colors/Black.png"
inner = plistlib.dumps({"style": 1}, fmt=plistlib.FMT_BINARY)
def patch(n):
    if isinstance(n, dict):
        if n.get("Provider","").startswith("com.apple.wallpaper.choice."):
            n["Provider"] = "com.apple.wallpaper.choice.image"
            n["Files"] = [{"relative": NEW}]
            n["Configuration"] = inner
        for v in list(n.values()): patch(v)
    elif isinstance(n, list):
        for v in n: patch(v)
patch(d)
p.write_bytes(plistlib.dumps(d, fmt=plistlib.FMT_BINARY))
print("PATCHED", p)
PY
chflags uchg "$P"
ls -lO "$P"
killall WallpaperAgent 2>/dev/null || true
sleep 3
pgrep -lf WallpaperAgent || echo NO_AGENT
