#!/usr/bin/env bash
# vmui — first-time setup for the Ubuntu KVM guest.
#
# Run with:  wsl -d Ubuntu-24.04 -- bash /mnt/e/gh/vmui/scripts/setup-ubuntu-vm.sh
#
# What this does:
#   1. Installs QEMU + OVMF + cloud-init utils (genisoimage, mkpasswd).
#   2. Creates ~/vmui-vms/ubuntu and copies OVMF firmware into it.
#   3. Creates Ubuntu.qcow2 (50 GiB sparse) if it doesn't exist.
#   4. Downloads the latest Ubuntu LTS desktop ISO (defaults to 26.04).
#   5. Builds seed.iso (NoCloud cloud-init datasource) baking
#      dragos:REDACTED_GUEST_PASSWORD + sudo + ssh + ubuntu-desktop-minimal.
#
# The Ubuntu Desktop installer (24.04+) honors autoinstall via the NoCloud
# datasource — when the seed.iso is attached, the installer runs unattended.
set -euo pipefail

VMDIR="${VMDIR:-$HOME/vmui-vms/ubuntu}"
DISK_GB="${DISK_GB:-50}"
USERNAME="${UBUNTU_USERNAME:-dragos}"
PASSWORD="${UBUNTU_PASSWORD:-REDACTED_GUEST_PASSWORD}"
HOSTNAME_U="${UBUNTU_HOSTNAME:-vmui-ubuntu}"
RELEASE="${UBUNTU_RELEASE:-26.04}"
# Ubuntu 26.04 LTS desktop ISO (Resolute Raccoon, released 2026-04-23).
ISO_URL_DEFAULT="https://releases.ubuntu.com/${RELEASE}/ubuntu-${RELEASE}-desktop-amd64.iso"
ISO_URL="${UBUNTU_ISO_URL:-$ISO_URL_DEFAULT}"

echo "=== [1/5] apt install qemu, ovmf, cloud-init tooling ==="
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  qemu-system-x86 qemu-utils ovmf \
  genisoimage whois curl ca-certificates 2>&1 | tail -5

mkdir -p "$VMDIR"
cd "$VMDIR"

echo
echo "=== [2/5] Copy OVMF firmware ==="
SRC_CODE=""
for cand in /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/OVMF/OVMF_CODE.fd; do
  if [ -f "$cand" ]; then SRC_CODE="$cand"; break; fi
done
SRC_VARS=""
for cand in /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/OVMF/OVMF_VARS.fd; do
  if [ -f "$cand" ]; then SRC_VARS="$cand"; break; fi
done
if [ -z "$SRC_CODE" ] || [ -z "$SRC_VARS" ]; then
  echo "ERROR: OVMF firmware files not found under /usr/share/OVMF." >&2
  exit 1
fi
cp -f "$SRC_CODE" OVMF_CODE.fd
[ -f OVMF_VARS.fd ] || cp -f "$SRC_VARS" OVMF_VARS.fd
echo "  CODE: $SRC_CODE"
echo "  VARS: $SRC_VARS  → ./OVMF_VARS.fd"

echo
echo "=== [3/5] Create main disk Ubuntu.qcow2 (${DISK_GB} GiB, sparse) ==="
if [ -f Ubuntu.qcow2 ]; then
  echo "  exists, skipping"
else
  qemu-img create -f qcow2 -o nocow=on Ubuntu.qcow2 "${DISK_GB}G"
fi

echo
echo "=== [4/5] Download Ubuntu ${RELEASE} desktop ISO ==="
if [ -f ubuntu.iso ]; then
  echo "  exists, skipping ($(du -h ubuntu.iso | cut -f1))"
else
  echo "  fetching $ISO_URL"
  curl -L --fail --progress-bar -o ubuntu.iso.tmp "$ISO_URL"
  mv ubuntu.iso.tmp ubuntu.iso
fi
ls -lh ubuntu.iso | awk '{print "  size:", $5}'

echo
echo "=== [5/5] Build seed.iso (NoCloud cloud-init: user=$USERNAME) ==="
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Hash the password with SHA-512 crypt — cloud-init refuses plaintext.
PWHASH="$(mkpasswd -m sha-512 "$PASSWORD" 2>/dev/null || true)"
if [ -z "$PWHASH" ]; then
  PWHASH="$(openssl passwd -6 "$PASSWORD")"
fi

cat > "$WORK/meta-data" <<META
instance-id: vmui-ubuntu-1
local-hostname: $HOSTNAME_U
META

# autoinstall schema — this is the format the Ubuntu Desktop / Server
# installer (subiquity) consumes when the NoCloud datasource is present.
# `interactive-sections: []` makes it fully unattended.
cat > "$WORK/user-data" <<USERDATA
#cloud-config
autoinstall:
  version: 1
  interactive-sections: []
  locale: en_US.UTF-8
  keyboard:
    layout: us
  identity:
    hostname: $HOSTNAME_U
    realname: $USERNAME
    username: $USERNAME
    password: "$PWHASH"
  ssh:
    install-server: true
    allow-pw: true
  packages:
    - openssh-server
    - x11vnc
    - net-tools
    - curl
  user-data:
    disable_root: true
    timezone: Etc/UTC
    chpasswd:
      expire: false
  late-commands:
    - 'echo "$USERNAME ALL=(ALL) NOPASSWD: ALL" > /target/etc/sudoers.d/90-$USERNAME'
    - 'curtin in-target --target=/target -- systemctl set-default graphical.target || true'
    - 'curtin in-target --target=/target -- systemctl enable ssh || true'
USERDATA

# meta-data + user-data must be on a volume labelled CIDATA for cloud-init
# to detect it as the NoCloud datasource.
genisoimage -quiet -output seed.iso -volid CIDATA -joliet -rock \
  "$WORK/user-data" "$WORK/meta-data"
ls -lh seed.iso | awk '{print "  size:", $5}'

echo
echo "VM directory : $VMDIR"
ls -1 "$VMDIR"
echo
cat <<EOF
=== ✅ UBUNTU_SETUP_DONE ===

Start the VM via the VS Code task "vmui: start ubuntu VM" or the vmui UI.
First boot will run the unattended installer (~10 minutes).
After install, you can detach the installer ISO; the VM will boot from disk.

Default credentials baked in: $USERNAME / $PASSWORD
VNC : 127.0.0.1:7900   (full GUI via virtio-vga)
SSH : ssh -p 10024 $USERNAME@127.0.0.1
EOF
