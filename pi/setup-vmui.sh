#!/usr/bin/env bash
# One-shot on homepi: Node 22 + pnpm + repo clone + swap for the build.
# Idempotent; re-run safely. Runs as dragos with passwordless sudo.
set -euo pipefail

if [ ! -f /swapfile ] || [ "$(stat -c %s /swapfile)" -lt 4000000000 ]; then
  sudo swapoff /swapfile 2>/dev/null || true
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
sudo swapon /swapfile 2>/dev/null || true

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y nodejs >/dev/null
fi
sudo corepack enable >/dev/null 2>&1 || sudo npm i -g corepack >/dev/null
corepack prepare pnpm@latest --activate >/dev/null
sudo apt-get install -y build-essential python3 >/dev/null

mkdir -p /srv/homepi/vmui
sudo apt-get install -y rsync >/dev/null

echo "node $(node -v) pnpm $(pnpm -v) swap $(free -h | awk '/Swap/{print $2}')"
