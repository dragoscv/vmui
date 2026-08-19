#!/usr/bin/env bash
# vmui — request a clean shutdown inside the macOS guest over SSH.
# Silent no-op if the guest is unreachable (already off / still booting).
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
  -o LogLevel=ERROR -o PreferredAuthentications=password -o ConnectTimeout=8 \
  -p "$PORT" "$USER_GUEST@$HOST" bash -s <<REMOTE 2>/dev/null
echo "$PASS_GUEST" | sudo -S -p '' shutdown -h now
REMOTE

exit 0
