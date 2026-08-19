#!/bin/bash
# Credentials come from .private/credentials.env (gitignored).
# shellcheck source=lib/guest-credentials.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/guest-credentials.sh"

set +e
for i in 1 2 3 4 5 6 7 8 9 10; do
  echo "=== probe $i ==="
  if SSHPASS="$MAC_GUEST_PASS" sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8 -o PreferredAuthentications=password -p 10024 dragos@127.0.0.1 "echo SSH_OK; uname -a" 2>&1; then
    echo "SSH_REACHED"
    break
  fi
  sleep 10
done

echo "=== running upgrade remotely ==="
SSHPASS="$MAC_GUEST_PASS" sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o PreferredAuthentications=password -p 10024 dragos@127.0.0.1 bash -s <<REMOTE
set +e
echo "--- waiting for cloud-init to finish if running ---"
sudo cloud-init status --wait 2>&1 | tail -5
echo "--- apt update ---"
sudo apt-get update -qq 2>&1 | tail -3
echo "--- apt full-upgrade ---"
sudo DEBIAN_FRONTEND=noninteractive apt-get -y -qq -o Dpkg::Options::="--force-confold" full-upgrade 2>&1 | tail -10
echo "--- install desktop pkgs ---"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ubuntu-desktop-minimal gdm3 qemu-guest-agent 2>&1 | tail -5
echo "--- set graphical default + enable gdm3 ---"
sudo systemctl set-default graphical.target
sudo systemctl enable gdm3
sudo systemctl start gdm3 || true
echo "--- status ---"
systemctl get-default
systemctl is-active gdm3
echo "--- isolating graphical.target (will detach) ---"
nohup sudo systemctl isolate graphical.target >/dev/null 2>&1 &
echo "ALL_DONE"
REMOTE
