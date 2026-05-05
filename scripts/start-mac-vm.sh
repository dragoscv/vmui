#!/usr/bin/env bash
# Start the macOS VM detached and verify it's listening
set -u
cd ~/OSX-KVM
rm -f /tmp/vmui-mac.pid /tmp/vmui-mac.log

# Always sync the latest boot-mac.sh from the vmui repo so edits on Windows
# take effect without manual cp.
if [ -f /mnt/e/gh/vmui/scripts/boot-mac.sh ]; then
  cp /mnt/e/gh/vmui/scripts/boot-mac.sh ./boot-mac.sh
  chmod +x ./boot-mac.sh
fi

# Detach from terminal entirely so it survives the WSL session ending
setsid bash -c './boot-mac.sh > /tmp/vmui-mac.log 2>&1 < /dev/null' &
disown

sleep 6
echo "=== log (first 50 lines) ==="
head -50 /tmp/vmui-mac.log 2>/dev/null
echo "--- pidfile ---"
cat /tmp/vmui-mac.pid 2>/dev/null && echo
echo "--- qemu process ---"
pgrep -af qemu-system-x86_64 | head -3
echo "--- listening ports ---"
ss -tln 2>/dev/null | grep -E ':(5900|4444|10022) ' || echo "no ports yet"
