#!/bin/bash
# Undo the CHROME_HEADLESS workaround, which suppresses window shadows.
#
# NOTE: this does NOT remove the thin square outline around windows. That is
# Tahoe's own 1px window stroke, drawn opaque because there is no Metal device
# to composite it — proven by A/B test: toggling disableWindowShadows produced
# a byte-identical rgb(62,62,62) edge pixel. Only a real GPU changes that.
set -u

PLIST="$HOME/Library/LaunchAgents/local.vmui.chromeheadless.plist"

echo "=== removing CHROME_HEADLESS ==="
launchctl unsetenv CHROME_HEADLESS 2>/dev/null || true
if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "  LaunchAgent removed"
else
  echo "  no LaunchAgent present"
fi

echo
echo "=== ensuring nothing else suppresses shadows ==="
defaults write com.apple.universalaccess reduceTransparency -bool false
defaults write com.apple.universalaccess increaseContrast -bool false
defaults delete com.apple.universalaccess disableWindowShadows 2>/dev/null || true
defaults -currentHost delete com.apple.universalaccess reduceTransparency 2>/dev/null || true
echo "  done"

echo
echo "=== restarting Dock and Finder ==="
killall Dock 2>/dev/null || true
killall Finder 2>/dev/null || true
echo "  done"

echo
echo "Shadows restored. Apps that are already open must be relaunched to redraw."
