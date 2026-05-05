#!/usr/bin/env bash
# Launch macOS VM and KEEP this shell alive so the WSL distro stays running.
# Used by Start-Process from PowerShell to pin a persistent Windows handle on
# the distro (otherwise WSL2 idle-shuts the VM after ~60s, killing QEMU).
set -u

cd "$HOME/OSX-KVM" || { echo "ERROR: ~/OSX-KVM not found"; exit 1; }

# Always sync the latest boot-mac.sh from the vmui repo
if [ -f /mnt/e/gh/vmui/scripts/boot-mac.sh ]; then
  cp /mnt/e/gh/vmui/scripts/boot-mac.sh ./boot-mac.sh
  chmod +x ./boot-mac.sh
fi

rm -f /tmp/vmui-mac.pid /tmp/vmui-mac.log /tmp/vmui-mac.qemu.log

# Run boot-mac.sh in foreground (this script's stdout/stderr goes to log)
# When QEMU exits (clean shutdown / crash), this script exits and WSL can idle.
exec ./boot-mac.sh > /tmp/vmui-mac.log 2>&1 < /dev/null
