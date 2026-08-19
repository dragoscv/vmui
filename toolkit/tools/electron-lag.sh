#!/bin/bash
# Workaround for the macOS Tahoe Electron redraw loop.
#
# Affected builds call the private NSWindow _cornerMask on every frame; on
# Tahoe that path is far more expensive, so the app pegs WindowServer and the
# whole desktop stutters. CHROME_HEADLESS makes Chromium skip the shadow/corner
# work.
#
# TRADE-OFF: it also suppresses window shadows, and macOS then draws a flat
# square frame instead. Only apply this if you actually run an affected app;
# restore-shadows.sh reverses it.
set -u

echo "=== applying CHROME_HEADLESS ==="
launchctl setenv CHROME_HEADLESS 1

PLIST="$HOME/Library/LaunchAgents/local.vmui.chromeheadless.plist"
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>          <string>local.vmui.chromeheadless</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>CHROME_HEADLESS</string>
    <string>1</string>
  </array>
  <key>RunAtLoad</key>      <true/>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || true
echo "  set, and persisted across reboots"

echo
echo "Applied. Restart Electron apps for it to take effect."
echo "Side effect: window shadows are suppressed — use 'Restore window shadows' to undo."
