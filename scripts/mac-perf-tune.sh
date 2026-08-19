#!/usr/bin/env bash
# vmui — post-upgrade performance tuning for the macOS guest.
#
# A major macOS upgrade re-enables Spotlight indexing and Time Machine and
# resets several UI defaults, so this must be re-run after every upgrade.
# Complements mac-remote-tune.sh (which targets Screen Sharing specifically).
#
# Idempotent. Usage: mac-perf-tune.sh
# Credentials come from .private/credentials.env (gitignored).
# shellcheck source=lib/guest-credentials.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/guest-credentials.sh"

set -u

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-10022}"
USER_GUEST="${USER_GUEST:-dragos}"
PASS_GUEST="${PASS_GUEST:-${MAC_GUEST_PASS}}"

sshpass -p "$PASS_GUEST" ssh \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR -o PreferredAuthentications=password -o ConnectTimeout=10 \
  -p "$PORT" "$USER_GUEST@$HOST" bash -s <<REMOTE
set -u
PASS="$PASS_GUEST"
$(cat <<'INNER'
sudo_() { echo "$PASS" | sudo -S -p '' "$@"; }

echo "=== Spotlight: stop indexing (re-enabled by every major upgrade) ==="
sudo_ mdutil -a -i off 2>&1 | sed 's/^/  /'
sudo_ mdutil -a -E 2>/dev/null | sed 's/^/  /' || true
# Stop the daemons that are mid-crawl right now.
sudo_ launchctl disable system/com.apple.metadata.mds 2>/dev/null || true

echo
echo "=== Time Machine: no local snapshots (they stall the disk) ==="
sudo_ tmutil disable 2>/dev/null || true
for s in $(tmutil listlocalsnapshots / 2>/dev/null | grep -o 'com.apple.TimeMachine.*'); do
  sudo_ tmutil deletelocalsnapshots "${s##*.}" 2>/dev/null || true
done
sudo_ launchctl disable system/com.apple.backupd 2>/dev/null || true

echo
echo "=== Siri / Spotlight suggestions / analytics off ==="
defaults write com.apple.assistant.support "Assistant Enabled" -bool false 2>/dev/null || true
defaults write com.apple.Siri StatusMenuVisible -bool false 2>/dev/null || true
defaults write com.apple.Siri VoiceTriggerUserEnabled -bool false 2>/dev/null || true
sudo_ defaults write /Library/Application\ Support/CrashReporter/DiagnosticMessagesHistory.plist AutoSubmit -bool false 2>/dev/null || true

echo
echo "=== window/UI animations off (upgrades reset these) ==="
defaults write NSGlobalDomain NSAutomaticWindowAnimationsEnabled -bool false
defaults write NSGlobalDomain NSScrollAnimationEnabled -bool false
defaults write NSGlobalDomain NSWindowResizeTime -float 0.001
defaults write NSGlobalDomain NSToolbarFullScreenAnimationDuration -float 0
defaults write NSGlobalDomain QLPanelAnimationDuration -float 0
defaults write NSGlobalDomain NSDocumentRevisionsWindowTransformAnimation -bool false
defaults write com.apple.universalaccess reduceMotion -bool true
defaults write com.apple.Accessibility ReduceMotionEnabled -int 1

# reduceTransparency is deliberately LEFT OFF. It swaps vibrancy for an opaque
# fill and then draws a hard 1px outline around every window to replace the
# depth cue the blur provided — visually ugly over SPICE/VNC. Measured on
# Tahoe with no GPU: enabling it did NOT reduce idle WindowServer CPU (0.0%
# either way), so it costs appearance for no gain here.
defaults write com.apple.universalaccess reduceTransparency -bool false
defaults write com.apple.universalaccess increaseContrast -bool false
defaults write com.apple.universalaccess differentiateWithoutColor -bool false
defaults write com.apple.dock launchanim -bool false
defaults write com.apple.dock expose-animation-duration -float 0.05
defaults write com.apple.dock autohide-time-modifier -float 0
defaults write com.apple.finder DisableAllAnimations -bool true
# No wallpaper motion / dynamic desktop re-render.
defaults write com.apple.WindowManager EnableTiledWindowMargins -bool false 2>/dev/null || true

echo
echo "=== power: never sleep ==="
sudo_ pmset -a sleep 0 displaysleep 0 disksleep 0 hibernatemode 0 standby 0 autopoweroff 0 powernap 0 2>/dev/null || true

echo
echo "=== Apple Screen Sharing on :5900 in-guest (forwarded to host :5901) ==="
sudo_ launchctl enable system/com.apple.screensharing 2>/dev/null || true
sudo_ launchctl bootstrap system /System/Library/LaunchDaemons/com.apple.screensharing.plist 2>/dev/null || true
sudo_ launchctl kickstart -k system/com.apple.screensharing 2>/dev/null || true

echo
echo "=== restart UI ==="
killall Dock Finder 2>/dev/null || true

echo
echo "=== RESULT ==="
echo -n "spotlight: "; mdutil -s / 2>&1 | tail -1
echo -n "screensharing listening in guest: "
(netstat -an 2>/dev/null | grep -q '\.5900.*LISTEN' && echo yes) || echo no
INNER
)
REMOTE
