#!/usr/bin/env bash
# vmui — restore macOS window drop shadows.
#
# Symptom: every window shows a hard SQUARE 1px outline around its rounded
# corners. That outline is what macOS draws when window shadows are disabled —
# it substitutes a flat frame for the shadow, and the frame does not follow the
# corner radius, so it looks broken.
#
# Cause here: CHROME_HEADLESS=1 was set (via LaunchAgent) to work around the
# macOS Tahoe Electron `_cornerMask` bug. It tells Chromium/Electron to skip
# shadow drawing. That workaround is no longer needed on this guest — the only
# affected app (MMO Companion) was uninstalled 2026-08-18, and VS Code Insiders
# already ships the upstream Electron fix.
#
# This removes the workaround and re-enables shadows everywhere.
#
# Usage: mac-restore-window-shadows.sh
#        REVERT=1 mac-restore-window-shadows.sh   (put the workaround back)
# Credentials come from .private/credentials.env (gitignored).
# shellcheck source=lib/guest-credentials.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/guest-credentials.sh"

set -u

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-10022}"
USER_GUEST="${USER_GUEST:-dragos}"
PASS_GUEST="${PASS_GUEST:-${MAC_GUEST_PASS}}"
REVERT="${REVERT:-0}"

sshpass -p "$PASS_GUEST" ssh \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR -o PreferredAuthentications=password -o ConnectTimeout=10 \
  -p "$PORT" "$USER_GUEST@$HOST" bash -s <<REMOTE
set -u
PASS="$PASS_GUEST"
REVERT="$REVERT"
$(cat <<'INNER'
sudo_() { echo "$PASS" | sudo -S -p '' "$@"; }
PLIST="$HOME/Library/LaunchAgents/local.vmui.chromeheadless.plist"

if [ "$REVERT" = "1" ]; then
  echo "=== re-applying the CHROME_HEADLESS workaround ==="
  launchctl setenv CHROME_HEADLESS 1
  echo "done (shadows will be suppressed again in Electron apps)"
  exit 0
fi

echo "=== removing CHROME_HEADLESS (it suppresses window shadows) ==="
launchctl unsetenv CHROME_HEADLESS 2>/dev/null || true
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
rm -f "$PLIST"

echo "=== making sure no accessibility setting is drawing borders ==="
defaults write com.apple.universalaccess reduceTransparency -bool false
defaults write com.apple.universalaccess increaseContrast -bool false
defaults write com.apple.universalaccess differentiateWithoutColor -bool false
defaults -currentHost write com.apple.universalaccess reduceTransparency -bool false 2>/dev/null || true

echo "=== ensure shadows are not disabled anywhere ==="
defaults delete com.apple.universalaccess disableWindowShadows 2>/dev/null || true
defaults delete -g NSWindowShadow 2>/dev/null || true
defaults write com.apple.screencapture disable-shadow -bool false 2>/dev/null || true

echo "=== restarting the UI so WindowServer redraws window frames ==="
killall Dock 2>/dev/null || true
killall Finder 2>/dev/null || true
sleep 6

echo
echo "=== RESULT ==="
echo -n "  CHROME_HEADLESS: "; launchctl getenv CHROME_HEADLESS || echo "(unset - good)"
echo -n "  LaunchAgent:     "; [ -f "$PLIST" ] && echo "STILL PRESENT" || echo "removed"
echo -n "  reduceTransparency: "; defaults read com.apple.universalaccess reduceTransparency 2>/dev/null
echo
echo "NOTE: apps already running must be RESTARTED to redraw their shadow."
INNER
)
REMOTE
