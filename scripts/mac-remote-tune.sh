#!/usr/bin/env bash
# vmui — tune the macOS guest for smooth remote viewing over Screen Sharing.
# Software-rendered VGA has no GPU: every animated/blurred/moving pixel costs
# CPU in WindowServer + screensharingd encode. This kills all of that.
# Idempotent; run any time via SSH. Usage: mac-remote-tune.sh
set -u

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-10022}"
USER_GUEST="${USER_GUEST:-dragos}"
PASS_GUEST="${PASS_GUEST:-REDACTED_GUEST_PASSWORD}"

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 -o PreferredAuthentications=password -p "$PORT")

sshpass -p "$PASS_GUEST" ssh -tt "${SSH_OPTS[@]}" "$USER_GUEST@$HOST" bash -s <<'REMOTE'
set -u
PASS=REDACTED_GUEST_PASSWORD
sudo_() { echo "$PASS" | sudo -S -p '' "$@"; }

echo "--- power: never sleep ---"
sudo_ pmset -a sleep 0 displaysleep 0 disksleep 0 hibernatemode 0 standby 0 autopoweroff 0 powernap 0

echo "--- animations / transparency off ---"
defaults write com.apple.dock mineffect -string scale
defaults write com.apple.dock launchanim -bool false
defaults write com.apple.dock expose-animation-duration -float 0.05
defaults write com.apple.dock autohide-time-modifier -float 0
defaults write com.apple.dock springboard-show-duration -float 0.05
defaults write com.apple.dock springboard-hide-duration -float 0.05
defaults write NSGlobalDomain NSAutomaticWindowAnimationsEnabled -bool false
defaults write NSGlobalDomain NSWindowResizeTime -float 0.001
defaults write NSGlobalDomain NSScrollAnimationEnabled -bool false
defaults write NSGlobalDomain NSToolbarFullScreenAnimationDuration -float 0
defaults write NSGlobalDomain QLPanelAnimationDuration -float 0
defaults write com.apple.universalaccess reduceMotion -bool true
defaults write com.apple.universalaccess reduceTransparency -bool true
defaults write com.apple.Accessibility ReduceMotionEnabled -int 1
defaults write com.apple.finder DisableAllAnimations -bool true

echo "--- remote-view quality: crisper text, less encode noise ---"
# medium font smoothing renders faster + compresses better over VNC
defaults -currentHost write -g AppleFontSmoothing -int 1
# NOTE: wallpaper is left untouched on purpose — set whatever image you like.
# A busy photo costs more VNC bandwidth only when the desktop is exposed; the
# choice is yours. (Previously forced a solid color here.)
# no screen saver (it would animate + wake encode loops)
defaults -currentHost write com.apple.screensaver idleTime -int 0

echo "--- background CPU eaters off ---"
# Spotlight indexing hammers CPU/disk on a fresh image
sudo_ mdutil -a -i off >/dev/null 2>&1 || true
# Time Machine local snapshots
sudo_ tmutil disable 2>/dev/null || true

echo "--- keep native Screen Sharing daemon (fast path, port 5901) ---"
sudo_ launchctl enable system/com.apple.screensharing
sudo_ launchctl bootstrap system /System/Library/LaunchDaemons/com.apple.screensharing.plist 2>/dev/null || true
sudo_ launchctl kickstart system/com.apple.screensharing 2>/dev/null || true

killall Dock Finder 2>/dev/null || true
echo "TUNE_DONE"
exit
REMOTE
