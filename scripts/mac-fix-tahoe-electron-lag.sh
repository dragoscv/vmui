#!/usr/bin/env bash
# vmui — work around the macOS Tahoe / Electron WindowServer lag bug.
#
# Electron builds older than 36.9.2 / 37.6.0 / 38.2.0 override the private
# AppKit `_cornerMask` API to fake corner smoothing. Tahoe's new compositor
# treats that as a shadow invalidation, so WindowServer recalculates and
# repaints every window shadow in a loop — system-wide lag, even when the app
# is idle. Root cause and fix: electron/electron#48376.
#
# On a GPU-less QEMU guest this is much worse than on real hardware: every one
# of those repaints is software-composited AND re-encoded for VNC.
#
# Setting CHROME_HEADLESS=1 in the user's launchd session makes Chromium skip
# window shadow drawing entirely, which sidesteps the override. Trade-off:
# Electron windows lose their drop shadows (cosmetic only).
#
# Installed as a LaunchAgent so it survives reboots. Idempotent.
#
# Usage: mac-fix-tahoe-electron-lag.sh          (apply)
#        REVERT=1 mac-fix-tahoe-electron-lag.sh (undo)
set -u

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-10022}"
USER_GUEST="${USER_GUEST:-dragos}"
PASS_GUEST="${PASS_GUEST:-REDACTED_GUEST_PASSWORD}"
REVERT="${REVERT:-0}"

sshpass -p "$PASS_GUEST" ssh \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR -o PreferredAuthentications=password -o ConnectTimeout=10 \
  -p "$PORT" "$USER_GUEST@$HOST" bash -s <<REMOTE
set -u
PASS="$PASS_GUEST"
REVERT="$REVERT"
$(cat <<'INNER'
PLIST="$HOME/Library/LaunchAgents/local.vmui.chromeheadless.plist"

if [ "$REVERT" = "1" ]; then
  echo "=== reverting ==="
  launchctl unsetenv CHROME_HEADLESS 2>/dev/null || true
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed. restart Electron apps to restore shadows."
  exit 0
fi

echo "=== applying CHROME_HEADLESS for the current session ==="
launchctl setenv CHROME_HEADLESS 1

echo "=== installing LaunchAgent so it survives reboot ==="
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<'PLI'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>local.vmui.chromeheadless</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/sh</string>
        <string>-c</string>
        <string>launchctl setenv CHROME_HEADLESS 1</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
PLI
chmod 644 "$PLIST"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || true

echo
echo "=== RESULT ==="
echo -n "CHROME_HEADLESS: "; launchctl getenv CHROME_HEADLESS || echo "(unset)"
echo -n "LaunchAgent:     "; [ -f "$PLIST" ] && echo "installed" || echo "MISSING"
echo
echo "NOTE: already-running Electron apps must be restarted to pick this up."
INNER
)
REMOTE
