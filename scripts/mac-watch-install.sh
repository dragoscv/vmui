#!/usr/bin/env bash
# vmui — watch a macOS in-guest install and distinguish PROGRESS from HANG.
#
# A hung macOS installer under QEMU spins every vCPU at 100% while writing
# nothing and rendering an identical frame, which looks superficially like a
# busy install. This samples three independent signals and calls it:
#   - guest SSH        (back up => finished)
#   - qcow2 growth     (bytes actually committed)
#   - screen MD5       (frame changing at all)
#
# Usage: mac-watch-install.sh <branch-qcow2-name> [max_minutes] [baseline_version]
#
# If baseline_version is given (e.g. 15.7.5), the watcher ignores the guest
# while it still reports that version — otherwise it would instantly declare
# success during the pre-restart download phase.
# Credentials come from .private/credentials.env (gitignored).
# shellcheck source=lib/guest-credentials.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/guest-credentials.sh"

set -u

BRANCH="${1:?usage: mac-watch-install.sh <branch.qcow2> [max_minutes]}"
MAX_MIN="${2:-120}"
BASELINE="${3:-}"
IMG="/home/dragos/OSX-KVM/$BRANCH"
INTERVAL=60
STALL_LIMIT=15          # consecutive stalled samples (=15 min) before verdict

shot_md5() {
  {
    echo '{"execute":"qmp_capabilities"}'
    sleep 0.3
    echo '{"execute":"screendump","arguments":{"filename":"/tmp/mac-watch.ppm"}}'
    sleep 2.0
  } | nc -q 3 127.0.0.1 4444 >/dev/null 2>&1
  [ -f /tmp/mac-watch.ppm ] && md5sum /tmp/mac-watch.ppm | cut -d' ' -f1 || echo "noshot"
}

guest_version() {
  sshpass -p "$MAC_GUEST_PASS" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR -o PreferredAuthentications=password -o ConnectTimeout=5 \
    -p 10022 dragos@127.0.0.1 'sw_vers -productVersion' 2>/dev/null || true
}

prev_size=0
prev_md5=""
stalled=0
max_iter=$(( MAX_MIN * 60 / INTERVAL ))

echo "watching $BRANCH (max ${MAX_MIN}m, sample ${INTERVAL}s, stall verdict after ${STALL_LIMIT}m)"

for i in $(seq 1 "$max_iter"); do
  v=$(guest_version)
  if [ -n "$v" ] && [ "$v" != "$BASELINE" ]; then
    echo "[$(date +%H:%M:%S)] GUEST BACK — macOS $v"
    exit 0
  fi
  if [ -n "$v" ] && [ "$v" = "$BASELINE" ]; then
    echo "[$(date +%H:%M:%S)] guest still up on baseline $v (downloading / pre-restart)"
    prev_size=$(stat -c %s "$IMG" 2>/dev/null || echo 0)
    stalled=0
    sleep "$INTERVAL"
    continue
  fi

  if ! pgrep -f 'qemu-system-x86_64 -name vmui-mac' >/dev/null; then
    echo "[$(date +%H:%M:%S)] qemu not running (watchdog restart window)"
    sleep "$INTERVAL"
    continue
  fi

  size=$(stat -c %s "$IMG" 2>/dev/null || echo 0)
  md5=$(shot_md5)
  dsize=$(( size - prev_size ))

  if [ "$dsize" -gt 4194304 ] || [ "$md5" != "$prev_md5" ]; then
    stalled=0
    state="PROGRESS"
  else
    stalled=$(( stalled + 1 ))
    state="STALLED x$stalled"
  fi

  printf '[%s] %-12s size=%s (+%s MB) screen=%s\n' \
    "$(date +%H:%M:%S)" "$state" "$(numfmt --to=iec "$size")" "$(( dsize / 1048576 ))" "${md5:0:8}"

  prev_size="$size"
  prev_md5="$md5"

  if [ "$stalled" -ge "$STALL_LIMIT" ]; then
    echo "[$(date +%H:%M:%S)] VERDICT: HANG — no disk growth and no frame change for ${STALL_LIMIT} min."
    exit 2
  fi

  sleep "$INTERVAL"
done

echo "VERDICT: TIMEOUT after ${MAX_MIN}m (still no SSH)"
exit 1
