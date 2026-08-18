#!/bin/bash
# Force a true solid-black wallpaper via the supported API (not plist surgery).
# 1) unlock the store  2) generate an opaque 1920x1080 black PNG
# 3) set it through System Events  4) re-lock the store afterwards
set -u

P="/Users/dragos/Library/Application Support/com.apple.wallpaper/Store/Index.plist"
IMG="/Users/dragos/Pictures/pure-black.png"

chflags nouchg "$P" 2>/dev/null || true

# generate an opaque black PNG (Black.png from Apple is fine too, but make our own to be sure)
mkdir -p /Users/dragos/Pictures
/usr/bin/python3 - <<'PY'
import zlib, struct, pathlib
w, h = 1920, 1080
def chunk(t, d):
    c = struct.pack('>I', len(d)) + t + d
    return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
raw = b''.join(b'\x00' + b'\x00\x00\x00' * w for _ in range(h))
png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
       + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
pathlib.Path('/Users/dragos/Pictures/pure-black.png').write_bytes(png)
print('png written')
PY

# set through the real wallpaper API so WallpaperAgent owns the state
osascript -e "tell application \"System Events\" to tell every desktop to set picture to POSIX file \"$IMG\""
sleep 2
osascript -e 'tell application "System Events" to get picture of first desktop'

# re-lock so nothing overwrites it
chflags uchg "$P" 2>/dev/null && echo LOCKED
echo BLACK_SET
