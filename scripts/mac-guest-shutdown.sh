#!/usr/bin/env bash
# vmui — request a clean shutdown inside the macOS guest over SSH.
# Silent no-op if the guest is unreachable (already off / still booting).
set -u

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-10022}"
USER_GUEST="${USER_GUEST:-dragos}"
PASS_GUEST="${PASS_GUEST:-REDACTED_GUEST_PASSWORD}"

sshpass -p "$PASS_GUEST" ssh \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR -o PreferredAuthentications=password -o ConnectTimeout=8 \
  -p "$PORT" "$USER_GUEST@$HOST" bash -s <<REMOTE 2>/dev/null
echo "$PASS_GUEST" | sudo -S -p '' shutdown -h now
REMOTE

exit 0
