#!/usr/bin/env bash
# vmui — wait for macOS guest SSH, then disable all forms of sleep.
# Idempotent. Usage: mac-disable-sleep.sh [max_tries]
# Credentials come from .private/credentials.env (gitignored).
# shellcheck source=lib/guest-credentials.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/guest-credentials.sh"

set -u

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-10022}"
USER_GUEST="${USER_GUEST:-dragos}"
PASS_GUEST="${PASS_GUEST:-${MAC_GUEST_PASS}}"
TRIES="${1:-40}"

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=8 -o PreferredAuthentications=password -p "$PORT")

for i in $(seq 1 "$TRIES"); do
  out=$(sshpass -p "$PASS_GUEST" ssh "${SSH_OPTS[@]}" "$USER_GUEST@$HOST" "echo SSH_OK" 2>/dev/null)
  if [ "$out" = "SSH_OK" ]; then
    echo "ssh ready after try $i"
    sshpass -p "$PASS_GUEST" ssh -tt "${SSH_OPTS[@]}" "$USER_GUEST@$HOST" \
      "echo '$PASS_GUEST' | sudo -S -p '' pmset -a sleep 0 displaysleep 0 disksleep 0 hibernatemode 0 standby 0 autopoweroff 0 powernap 0; sudo -n pmset -g custom; exit"
    exit $?
  fi
  echo "try $i: not ready"
  sleep 15
done

echo "TIMEOUT waiting for SSH"
exit 1
