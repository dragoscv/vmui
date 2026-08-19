#!/bin/bash
# vmui Toolkit installer — run INSIDE the macOS guest.
#
#   curl/scp this directory into the guest, then:
#     bash install.sh              build + install + start
#     bash install.sh --dmg        also produce a distributable .dmg
#     bash install.sh --uninstall  remove everything
#
# Requires only the Command Line Tools (swiftc + macOS SDK). No Xcode, no
# Apple ID, no code-signing certificate.
set -euo pipefail

APP_NAME="vmui Toolkit"
BUNDLE_ID="ro.vmui.toolkit"
APP_DIR="/Applications/${APP_NAME}.app"
SUPPORT_DIR="$HOME/Library/Application Support/vmui-toolkit"
AGENT="$HOME/Library/LaunchAgents/${BUNDLE_ID}.plist"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="1.0.0"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

uninstall() {
  say "uninstalling"
  launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null || true
  rm -f "$AGENT"
  pkill -f "${APP_NAME}" 2>/dev/null || true
  rm -rf "$APP_DIR" "$SUPPORT_DIR"
  echo "  removed app, support files and LaunchAgent"
  exit 0
}

[ "${1:-}" = "--uninstall" ] && uninstall

# ---------------------------------------------------------------- checks ---
say "checking prerequisites"
if ! xcrun -f swiftc >/dev/null 2>&1; then
  echo "  ERROR: swiftc not found. Install the Command Line Tools:"
  echo "         xcode-select --install"
  exit 1
fi
echo "  swiftc: $(swift --version 2>/dev/null | head -1)"
echo "  SDK:    $(xcrun --show-sdk-version 2>/dev/null)"

# ----------------------------------------------------------------- build ---
say "building"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

swiftc -O -whole-module-optimization \
  -o "$BUILD/vmui-toolkit" \
  "$SRC_DIR/Sources/main.swift"
echo "  built $(du -h "$BUILD/vmui-toolkit" | cut -f1) binary"

# ------------------------------------------------------------ app bundle ---
say "assembling ${APP_NAME}.app"
CONTENTS="$BUILD/${APP_NAME}.app/Contents"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
cp "$BUILD/vmui-toolkit" "$CONTENTS/MacOS/vmui-toolkit"
chmod +x "$CONTENTS/MacOS/vmui-toolkit"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>              <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>       <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>        <string>${BUNDLE_ID}</string>
  <key>CFBundleVersion</key>           <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleExecutable</key>        <string>vmui-toolkit</string>
  <key>CFBundlePackageType</key>       <string>APPL</string>
  <key>LSMinimumSystemVersion</key>    <string>13.0</string>
  <!-- status-bar only: no Dock tile, no menu bar of its own -->
  <key>LSUIElement</key>               <true/>
  <key>NSHighResolutionCapable</key>   <true/>
</dict>
</plist>
PLIST
echo "  Info.plist written (LSUIElement — status bar only)"

# --------------------------------------------------------------- install ---
say "installing"
rm -rf "$APP_DIR"
cp -R "$BUILD/${APP_NAME}.app" /Applications/
echo "  $APP_DIR"

mkdir -p "$SUPPORT_DIR"
cp "$SRC_DIR/tools.json" "$SUPPORT_DIR/tools.json"
cp "$SRC_DIR"/tools/*.sh "$SUPPORT_DIR/"
chmod +x "$SUPPORT_DIR"/*.sh
echo "  $SUPPORT_DIR (manifest + $(ls -1 "$SRC_DIR"/tools/*.sh | wc -l | tr -d ' ') tools)"

# Unsigned apps get quarantined when copied; clear it so it launches cleanly.
xattr -dr com.apple.quarantine "$APP_DIR" 2>/dev/null || true

# ----------------------------------------------------------- launchagent ---
say "registering login item"
mkdir -p "$(dirname "$AGENT")"
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>${BUNDLE_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${APP_DIR}/Contents/MacOS/vmui-toolkit</string>
  </array>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <false/>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT" 2>/dev/null || true
echo "  starts automatically at login"

# ------------------------------------------------------------------- dmg ---
if [ "${1:-}" = "--dmg" ]; then
  say "building disk image"
  STAGE="$BUILD/dmg"
  mkdir -p "$STAGE"
  cp -R "$BUILD/${APP_NAME}.app" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  OUT="$SRC_DIR/vmui-toolkit-${VERSION}.dmg"
  rm -f "$OUT"
  hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" \
    -ov -format UDZO "$OUT" >/dev/null
  echo "  $OUT ($(du -h "$OUT" | cut -f1))"
  echo
  echo "  NOTE: unsigned. On another Mac, Gatekeeper will block the first launch —"
  echo "        right-click > Open, or: xattr -dr com.apple.quarantine '/Applications/${APP_NAME}.app'"
fi

# ------------------------------------------------------------------ done ---
say "starting"
pkill -f "vmui-toolkit" 2>/dev/null || true
sleep 1
open -a "$APP_DIR" 2>/dev/null || "$APP_DIR/Contents/MacOS/vmui-toolkit" &
sleep 2

if pgrep -f vmui-toolkit >/dev/null; then
  echo "  running — look for 🛠 in the menu bar"
else
  echo "  did not start; check $SUPPORT_DIR/toolkit.log"
  exit 1
fi

say "installed"
echo "  Add a tool:  edit $SUPPORT_DIR/tools.json, then restart the app."
echo "  Uninstall:   bash install.sh --uninstall"
