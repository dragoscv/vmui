#!/usr/bin/env bash
# Helper used by Copilot to restart the Windows VM cleanly during dev.
set -u
echo "=== killing win QEMU ==="
pkill -9 -f 'qemu-system-x86_64.*qmp tcp:127.0.0.1:4445' 2>/dev/null
pkill -f 'swtpm.*vmui-vms/win' 2>/dev/null
rm -f /tmp/vmui-win.qemu.log /tmp/vmui-win.log /tmp/vmui-win-keypress.log /tmp/vmui-win.pid
echo "=== sleeping 15s for watchdog to respawn ==="
sleep 15
echo "=== process ==="
pgrep -af 'qemu.*4445' | head -1
echo "=== boot log ==="
tail -40 /tmp/vmui-win.log 2>/dev/null
echo "=== qemu err log ==="
tail -30 /tmp/vmui-win.qemu.log 2>/dev/null
echo "=== qcow2 ==="
ls -lh ~/vmui-vms/win/Win11.qcow2
