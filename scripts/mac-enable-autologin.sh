#!/usr/bin/env bash
# vmui — enable macOS auto-login for the guest user.
#
# A headless VM that stops at the login window has no WindowServer session, so
# Screen Sharing shows only the login screen and no GUI app is reachable. Auto
# login makes every restart land on the desktop.
#
# macOS stores the auto-login password in /etc/kcpassword, obfuscated with a
# fixed XOR key (not encryption). That is Apple's design, not a choice here:
# anyone with root on the guest can recover it. Acceptable for a local
# throwaway VM whose password is already in these scripts; do NOT use this
# pattern on a machine that holds real secrets.
#
# Idempotent. Usage: mac-enable-autologin.sh
set -u

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-10022}"
USER_GUEST="${USER_GUEST:-dragos}"
PASS_GUEST="${PASS_GUEST:-REDACTED_GUEST_PASSWORD}"

sshpass -p "$PASS_GUEST" ssh \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR -o PreferredAuthentications=password -o ConnectTimeout=10 \
  -p "$PORT" "$USER_GUEST@$HOST" bash -s <<REMOTE
set -u
PASS="$PASS_GUEST"
GUEST_USER="$USER_GUEST"
$(cat <<'INNER'
sudo_() { echo "$PASS" | sudo -S -p '' "$@"; }

echo "=== FileVault must be OFF for auto-login ==="
fdesetup status 2>&1 | sed 's/^/  /'

echo
echo "=== writing /etc/kcpassword ==="
# Apple's fixed XOR key for kcpassword. Build the file as the normal user in
# /tmp, then move it into place with sudo — piping a heredoc straight into
# `sudo python3 -` does not work here because sudo consumes stdin for the
# password prompt.
cat > /tmp/vmui-kcpass.py <<'PY'
import sys
key = [0x7D, 0x89, 0x52, 0x23, 0xD2, 0xBC, 0xDD, 0xEA, 0xA3, 0xB9, 0x1F]
pw = sys.argv[1].encode()
out = bytearray()
for i, b in enumerate(pw):
  out.append(b ^ key[i % len(key)])
# Pad up to the next multiple of 12 so loginwindow accepts it.
pad = 12 - (len(pw) % 12)
for i in range(len(pw), len(pw) + pad):
  out.append(key[i % len(key)])
open('/tmp/vmui-kcpassword', 'wb').write(bytes(out))
PY
/usr/bin/python3 /tmp/vmui-kcpass.py "$PASS"
sudo_ cp /tmp/vmui-kcpassword /etc/kcpassword
rm -f /tmp/vmui-kcpass.py /tmp/vmui-kcpassword
sudo_ chmod 600 /etc/kcpassword
sudo_ chown root:wheel /etc/kcpassword

echo "=== setting autoLoginUser ==="
sudo_ defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser -string "$GUEST_USER"
sudo_ defaults delete /Library/Preferences/com.apple.loginwindow autoLoginUserScreenLocked 2>/dev/null || true
# Do not require a password to wake from sleep/screensaver either.
sudo_ defaults write /Library/Preferences/com.apple.screensaver askForPassword -int 0 2>/dev/null || true
defaults write com.apple.screensaver askForPassword -int 0 2>/dev/null || true

echo
echo "=== RESULT ==="
echo -n "autoLoginUser: "
sudo_ defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || echo "(unset)"
echo -n "/etc/kcpassword: "
sudo_ ls -la /etc/kcpassword 2>/dev/null || echo "(missing)"
INNER
)
REMOTE
