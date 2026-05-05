#!/usr/bin/env bash
# vmui — OSX-KVM setup script for WSL2 Ubuntu
# Run with: wsl -- bash -c 'sudo -v && bash /mnt/e/gh/vmui/scripts/setup-osx-kvm.sh'
set -euo pipefail

echo "=== [1/6] apt update + install QEMU/libvirt stack ==="
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  qemu-system-x86 qemu-utils libvirt-daemon-system libvirt-clients \
  bridge-utils python3 python3-pip python3-requests python3-click \
  dmg2img git uml-utilities iptables uuid-runtime 2>&1 | tail -5

echo
echo "=== [2/6] Add $USER to kvm + libvirt groups ==="
sudo usermod -aG kvm,libvirt "$USER"
echo "Groups now: $(getent group kvm libvirt | cut -d: -f1,3,4 | tr '\n' ' ')"

echo
echo "=== [3/6] Start libvirtd ==="
sudo service libvirtd start || true
sudo service libvirtd status | head -3 || true

echo
echo "=== [4/6] Clone or update OSX-KVM ==="
cd ~
if [ -d OSX-KVM/.git ]; then
  echo "Already cloned, pulling..."
  cd OSX-KVM && git pull --ff-only 2>&1 | tail -3
else
  git clone --depth 1 https://github.com/kholia/OSX-KVM.git 2>&1 | tail -3
fi

echo
echo "=== [5/6] Verify versions ==="
qemu-system-x86_64 --version | head -1
echo "virsh: $(virsh --version 2>&1)"
python3 --version
echo "dmg2img: $(dmg2img 2>&1 | head -1)"

echo
echo "=== [6/6] Diagnostics ==="
ls -la /dev/kvm
echo "OSX-KVM tree:"
ls ~/OSX-KVM/ | head -25

echo
echo "=== ✅ SETUP_DONE ==="
echo "Next: download the macOS Sonoma installer with:"
echo "  cd ~/OSX-KVM && ./fetch-macOS-v2.py"
