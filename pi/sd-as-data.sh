#!/usr/bin/env bash
# homepi: make the USB stick the primary boot device and turn the microSD into
# a plain ext4 data disk at /srv/data. Idempotent. Refuses to run unless the
# running root is on /dev/sda.
set -euo pipefail

ROOTDEV=$(findmnt -n -o SOURCE /)
case "$ROOTDEV" in /dev/sda*) ;; *) echo "root is $ROOTDEV, not the USB stick; aborting" >&2; exit 1;; esac

# 0xf41: USB first, then SD, then restart the loop. Applied at next reboot.
CUR=$(sudo rpi-eeprom-config | grep -E '^BOOT_ORDER=' | cut -d= -f2)
if [ "$CUR" != "0xf41" ]; then
  sudo rpi-eeprom-config --out /tmp/eeprom.conf >/dev/null
  sudo sed -i 's/^BOOT_ORDER=.*/BOOT_ORDER=0xf41/' /tmp/eeprom.conf
  grep -q '^BOOT_ORDER=' /tmp/eeprom.conf || echo 'BOOT_ORDER=0xf41' | sudo tee -a /tmp/eeprom.conf >/dev/null
  sudo rpi-eeprom-config --apply /tmp/eeprom.conf
  echo "eeprom: BOOT_ORDER $CUR -> 0xf41 (staged for next boot)"
else
  echo "eeprom: BOOT_ORDER already 0xf41"
fi

# Wipe the SD and format it as one ext4 partition labelled data.
if ! blkid -o value -s LABEL /dev/mmcblk0p1 2>/dev/null | grep -qx data; then
  sudo umount /dev/mmcblk0p1 /dev/mmcblk0p2 2>/dev/null || true
  sudo wipefs -a /dev/mmcblk0 >/dev/null
  sudo parted -s /dev/mmcblk0 mklabel gpt mkpart data ext4 1MiB 100%
  sleep 2
  sudo mkfs.ext4 -q -F -L data /dev/mmcblk0p1
  echo "sd: formatted as ext4 'data'"
fi
sudo mkdir -p /srv/data
UUID=$(blkid -o value -s UUID /dev/mmcblk0p1)
grep -q "$UUID" /etc/fstab || echo "UUID=$UUID /srv/data ext4 defaults,noatime,nofail,x-systemd.device-timeout=10 0 2" | sudo tee -a /etc/fstab >/dev/null
sudo mount -a
sudo chown dragos:dragos /srv/data
df -h /srv/data | tail -1
