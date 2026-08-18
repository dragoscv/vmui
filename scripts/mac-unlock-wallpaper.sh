#!/bin/bash
# Undo mac-lock-wallpaper.sh: clear the immutable flag on the wallpaper store
# so the user can pick any image in System Settings again.
set -u
P="/Users/dragos/Library/Application Support/com.apple.wallpaper/Store/Index.plist"
chflags nouchg "$P" && echo "FLAG_CLEARED"
ls -lO "$P"
killall WallpaperAgent 2>/dev/null || true
echo "DONE — wallpaper is user-controlled again"
