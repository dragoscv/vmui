#!/usr/bin/env bash
# vmui — enable Apple Screen Sharing inside the macOS guest.
#
# After running this once, you can connect from Windows with any VNC client
# (RealVNC, TigerVNC, TightVNC) to:
#
#     127.0.0.1:5901    user: dragos    password: ${MAC_GUEST_PASS}
#
# This is much faster than QEMU's built-in -vnc (host:5900) because Apple's
# ARD protocol does proper dirty-region tracking + JPEG/zlib encoding.
#
# Idempotent. Requires the VM up and SSH (host:10022 -> guest:22) reachable.
# Credentials come from .private/credentials.env (gitignored).
# shellcheck source=lib/guest-credentials.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/guest-credentials.sh"

set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-10022}"
USER="${USER_GUEST:-dragos}"
PASS="${PASS_GUEST:-${MAC_GUEST_PASS}}"

if ! command -v sshpass >/dev/null; then
  echo "ERROR: sshpass not found. Install with: sudo apt install sshpass" >&2
  exit 1
fi

ssh_run() {
  sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR -p "$PORT" "$USER@$HOST" "$@"
}

echo "=== enabling Apple Remote Desktop / Screen Sharing ==="
ssh_run "echo $PASS | sudo -S /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart \
    -activate -configure -access -on \
    -clientopts -setvnclegacy -vnclegacy yes \
    -clientopts -setvncpw -vncpw $PASS \
    -restart -agent -privs -all" || true

echo "=== launching screensharingd / com.apple.screensharing ==="
ssh_run "echo $PASS | sudo -S launchctl load -w /System/Library/LaunchDaemons/com.apple.screensharing.plist 2>/dev/null || true"

echo "=== verifying port 5900 listens inside guest ==="
ssh_run "lsof -nP -iTCP:5900 -sTCP:LISTEN 2>/dev/null | head -5 || netstat -an | grep 5900 | head -5"

cat <<EOF

OK. Connect from Windows:

    VNC Viewer -> 127.0.0.1:5901
    Username:   $USER
    Password:   $PASS

(QEMU already forwards host:5901 -> guest:5900.)
EOF
