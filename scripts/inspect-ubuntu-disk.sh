#!/usr/bin/env bash
# Inspect installed Ubuntu disk while VM runs, via overlay snapshot + qemu-nbd.
set -e
BASE=/home/dragos/vmui-vms/ubuntu/Ubuntu.qcow2
SNAP=/tmp/vmui-ubuntu-inspect.qcow2
MNT=/tmp/vmrootview

sudo modprobe nbd max_part=16 2>/dev/null || true
sudo qemu-nbd --disconnect /dev/nbd0 >/dev/null 2>&1 || true
rm -f "$SNAP"

# Build a read-only overlay so we don't conflict with the running VM's lock.
qemu-img create -f qcow2 -F qcow2 -b "$BASE" "$SNAP" >/dev/null

sudo qemu-nbd --read-only --connect=/dev/nbd0 "$SNAP"
sleep 1
echo "=== partitions ==="
sudo lsblk /dev/nbd0
echo "=== detect root partition ==="
ROOT=""
for p in /dev/nbd0p1 /dev/nbd0p2 /dev/nbd0p3 /dev/nbd0p4 /dev/nbd0p5 /dev/nbd0p6; do
  [ -b "$p" ] || continue
  fstype=$(sudo blkid -o value -s TYPE "$p" 2>/dev/null || true)
  echo "  $p type=$fstype"
  if [ "$fstype" = "ext4" ] || [ "$fstype" = "btrfs" ] || [ "$fstype" = "xfs" ]; then
    ROOT="$p"
  fi
done
[ -n "$ROOT" ] || { echo "NO_ROOT_PART"; sudo qemu-nbd --disconnect /dev/nbd0; exit 0; }
echo "=== mount $ROOT ==="
mkdir -p "$MNT"
sudo mount -o ro "$ROOT" "$MNT"

# If LVM, the rootfs may be inside; check.
if [ ! -d "$MNT/etc" ] && [ -d "$MNT/@" ]; then
  sudo umount "$MNT"
  sudo mount -o ro,subvol=@ "$ROOT" "$MNT"
fi

echo "=== ls / ==="
ls "$MNT" | head
echo "=== /etc/os-release ==="
cat "$MNT/etc/os-release" 2>/dev/null | head -6 || echo NO_OS
echo "=== human users ==="
awk -F: '$3>=1000 && $3<65000' "$MNT/etc/passwd" 2>/dev/null || echo NO_PASSWD
echo "=== shadow hashes ==="
sudo awk -F: '{print $1, substr($2,1,4)}' "$MNT/etc/shadow" 2>/dev/null | grep -E '^(dragos|ubuntu|root|installer) ' || echo NO_SHADOW
echo "=== sshd ==="
[ -f "$MNT/etc/ssh/sshd_config" ] && echo HAS_SSHD_CFG || echo NO_SSHD_CFG
[ -f "$MNT/usr/sbin/sshd" ] && echo HAS_SSHD_BIN || echo NO_SSHD_BIN
echo "=== installer logs ==="
sudo ls "$MNT/var/log/installer/" 2>/dev/null || echo NO_INSTALLER_LOGS
echo "--- autoinstall-user-data ---"
sudo head -120 "$MNT/var/log/installer/autoinstall-user-data" 2>/dev/null || echo NONE
echo "--- subiquity-server-info ---"
sudo grep -E 'identity|username|password|autoinstall' "$MNT/var/log/installer/subiquity-server-debug.log" 2>/dev/null | tail -40 || echo NONE

sudo umount "$MNT" || true
sudo qemu-nbd --disconnect /dev/nbd0
rm -f "$SNAP"
