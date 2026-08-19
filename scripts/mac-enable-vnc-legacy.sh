#!/usr/bin/env bash
# vmui — make Apple Screen Sharing usable from a standard VNC client.
#
# macOS Screen Sharing defaults to Apple's own Diffie-Hellman authentication.
# Standard VNC clients (TigerVNC, RealVNC, TightVNC, UltraVNC...) only speak
# RFB "VNC Authentication", and when they meet Apple's 1024-bit DH handshake
# they abort with:
#     "protocol error: key length is too long"
#
# The fix is Apple's own "VNC viewers may control screen with password"
# option, which enables the legacy RFB auth path alongside the Apple one.
# It requires an 8-character-max password stored (obfuscated, not encrypted)
# in /Library/Preferences/com.apple.VNCSettings.txt — that is Apple's design.
# Only acceptable on a local throwaway VM; never on a machine with real data.
#
# Usage: mac-enable-vnc-legacy.sh          (password defaults to VNC_PASS)
set -u

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-10022}"
USER_GUEST="${USER_GUEST:-dragos}"
PASS_GUEST="${PASS_GUEST:-REDACTED_GUEST_PASSWORD}"
# RFB VNC auth is limited to 8 characters by the protocol itself.
VNC_PASS="${VNC_PASS:-REDACTED_VNC_PASSWORD}"

sshpass -p "$PASS_GUEST" ssh \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR -o PreferredAuthentications=password -o ConnectTimeout=10 \
  -p "$PORT" "$USER_GUEST@$HOST" bash -s <<REMOTE
set -u
PASS="$PASS_GUEST"
VNCPW="$VNC_PASS"
GUEST_USER="$USER_GUEST"
$(cat <<'INNER'
sudo_() { echo "$PASS" | sudo -S -p '' "$@"; }

echo "=== writing the legacy VNC password ==="
# Apple obfuscates VNCSettings.txt with a fixed XOR key, same idea as kcpassword.
cat > /tmp/vmui-vncpw.py <<'PY'
import sys
# Apple's fixed XOR key for /Library/Preferences/com.apple.VNCSettings.txt.
KEY = bytes.fromhex('1734516e8c5e1a2b')
pw = sys.argv[1].encode()[:8]
pw = pw + b'\x00' * (8 - len(pw))
print(''.join('%02x' % (b ^ KEY[i]) for i, b in enumerate(pw)))
PY
/usr/bin/python3 /tmp/vmui-vncpw.py "$VNCPW" > /tmp/vmui-vncpw.txt
sudo_ cp /tmp/vmui-vncpw.txt /Library/Preferences/com.apple.VNCSettings.txt
sudo_ chmod 644 /Library/Preferences/com.apple.VNCSettings.txt
rm -f /tmp/vmui-vncpw.py /tmp/vmui-vncpw.txt

echo "=== enabling legacy VNC connections ==="
sudo_ defaults write /Library/Preferences/com.apple.RemoteManagement VNCLegacyConnectionsEnabled -bool true
sudo_ defaults write /Library/Preferences/com.apple.RemoteManagement allowInsecureDH -bool true
sudo_ defaults write /Library/Preferences/com.apple.RemoteManagement ScreenSharingReqPermEnabled -bool false

echo "=== restarting screensharing ==="
sudo_ launchctl kickstart -k system/com.apple.screensharing 2>/dev/null || true
sleep 3

echo
echo "=== RESULT ==="
echo -n "VNCLegacyConnectionsEnabled: "
sudo_ defaults read /Library/Preferences/com.apple.RemoteManagement VNCLegacyConnectionsEnabled 2>/dev/null
echo -n "VNCSettings.txt: "
sudo_ ls -la /Library/Preferences/com.apple.VNCSettings.txt 2>/dev/null || echo MISSING
echo -n "listening on 5900 in guest: "
(netstat -an 2>/dev/null | grep -q '\.5900.*LISTEN' && echo yes) || echo no
INNER
)
REMOTE
