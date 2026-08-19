#!/usr/bin/env bash
# vmui — route macOS guest sound to the QEMU USB audio card (heard over SPICE).
#
# The guest has BlackHole 16ch installed (a virtual loopback driver used for
# recording). It has no speakers, but it registers as an output device and
# macOS had selected it as the default — so every sound played into a void.
#
# The real card is "QEMU USB Audio", which QEMU bridges to the SPICE audio
# channel (boot-mac.sh: -audiodev spice). This selects it as the default
# output. Requires SwitchAudioSource (installed here if missing) because macOS
# exposes no scriptable API for changing the default device.
#
# Idempotent. Usage: mac-fix-audio-output.sh
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

echo "=== output devices macOS currently offers ==="
system_profiler SPAudioDataType 2>/dev/null | grep -E '^\s{8}[A-Za-z].*:$' | sed 's/^/  /'

echo
echo "=== is the QEMU card present in the USB tree? ==="
ioreg -p IOUSB -w0 2>/dev/null | grep -i 'QEMU USB Audio' >/dev/null \
  && echo "  yes — QEMU USB Audio is enumerated" \
  || { echo "  NO — the card is not attached; check -device usb-audio in boot-mac.sh"; exit 1; }

echo
echo "=== selecting it as the default output ==="
SAS=""
for c in /opt/homebrew/bin/SwitchAudioSource /usr/local/bin/SwitchAudioSource "$(command -v SwitchAudioSource 2>/dev/null)"; do
  [ -n "$c" ] && [ -x "$c" ] && { SAS="$c"; break; }
done

if [ -z "$SAS" ]; then
  echo "  SwitchAudioSource not found; trying to install via Homebrew..."
  BREW=""
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$b" ] && { BREW="$b"; break; }
  done
  if [ -n "$BREW" ]; then
    "$BREW" install switchaudio-osx >/dev/null 2>&1 || true
    for c in /opt/homebrew/bin/SwitchAudioSource /usr/local/bin/SwitchAudioSource; do
      [ -x "$c" ] && { SAS="$c"; break; }
    done
  else
    echo "  no Homebrew either."
  fi
fi

if [ -n "$SAS" ]; then
  echo "  using $SAS"
  "$SAS" -a -t output | sed 's/^/    available: /'
  TARGET=$("$SAS" -a -t output | grep -i -m1 'QEMU' || true)
  if [ -n "$TARGET" ]; then
    "$SAS" -t output -s "$TARGET" && echo "  default output -> $TARGET"
    "$SAS" -t system -s "$TARGET" 2>/dev/null && echo "  system alerts  -> $TARGET"
  else
    echo "  QEMU output device not listed by SwitchAudioSource"
  fi
else
  echo "  FALLBACK: cannot switch programmatically."
  echo "  Do it in the guest UI: System Settings > Sound > Output > 'QEMU USB Audio'."
fi

echo
echo "=== unmute + volume ==="
osascript -e 'set volume output volume 70 without output muted' 2>/dev/null && echo "  70%, unmuted"

echo
echo "=== RESULT ==="
system_profiler SPAudioDataType 2>/dev/null | grep -B1 'Default Output Device: Yes' | head -4
INNER
)
REMOTE
