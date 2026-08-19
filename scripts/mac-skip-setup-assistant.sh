#!/usr/bin/env bash
# vmui — dismiss the post-upgrade macOS Setup Assistant ("MiniBuddy").
#
# After a major macOS upgrade, Setup Assistant launches with -MiniBuddyYes and
# blocks the desktop on a Welcome/What's-New wizard. It sits at 0% CPU waiting
# for clicks while WindowServer burns ~150% CPU software-rendering it, so a
# headless VM looks "stuck in setup" indefinitely.
#
# This marks every wizard pane as already-seen and terminates the assistant.
# Idempotent; safe to re-run. Requires SSH to the guest.
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
REMOTE_USER="$USER_GUEST"
$(cat <<'INNER'
sudo_() { echo "$PASS" | sudo -S -p '' "$@"; }
PLIST="/Users/$REMOTE_USER/Library/Preferences/com.apple.SetupAssistant.plist"
VER=$(sw_vers -productVersion)
BUILD=$(sw_vers -buildVersion)

echo "=== marking every wizard pane as seen ($VER / $BUILD) ==="
for key in DidSeeSiriSetup DidSeeAppStore DidSeeTermsOfAddress DidSeeTouchIDSetup \
           DidSeeApplePaySetup DidSeeSyncSetup DidSeeSyncSetup2 DidSeeActivationLock \
           DidSeeLockdownMode DidSeeAccessibility DidSeePrivacy DidSeeCloudSetup \
           DidSeeScreenTime DidSeeAppearanceSetup DidSeeiCloudLoginForStorageServices; do
  defaults write "$PLIST" "$key" -bool true
done

# Tell the assistant the current build has already been through setup, so it
# does not relaunch on the next login.
defaults write "$PLIST" LastSeenBuddyBuildVersion -string "$BUILD"
defaults write "$PLIST" LastSeenCloudProductVersion -string "$VER"
defaults write "$PLIST" LastSeenDiagnosticsProductVersion -string "$VER"
defaults write "$PLIST" DidSeeNewFeaturesProductVersion -string "$VER"
defaults write "$PLIST" MiniBuddyShouldLaunchToResumeSetup -bool false
defaults write "$PLIST" MiniBuddyLaunchedPostMigration -bool true

# Machine-wide: suppress the pre-login setup pass too.
sudo_ defaults write /var/db/.AppleSetupDone -bool true 2>/dev/null || true
sudo_ touch /var/db/.AppleSetupDone 2>/dev/null || true

echo
echo "=== killing Setup Assistant ==="
sudo_ pkill -f "Setup Assistant" 2>/dev/null || true
sudo_ pkill -f mbuseragent 2>/dev/null || true
sudo_ pkill -f mbusertrampoline 2>/dev/null || true
sudo_ pkill -f mbsystemadministration 2>/dev/null || true
sleep 3

echo
echo "=== result ==="
if pgrep -f "Setup Assistant" >/dev/null; then
  echo "Setup Assistant STILL RUNNING"
else
  echo "Setup Assistant gone"
fi
pgrep -lx Dock || echo "Dock not up yet"
pgrep -lx Finder || echo "Finder not up yet"
INNER
)
REMOTE
