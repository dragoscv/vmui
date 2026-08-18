#!/usr/bin/env bash
# Usage: status-vm.sh <kind>  (mac | win | ubuntu)
# Prints qemu process, listening ports and pid file for the given VM kind.
set -u

KIND="${1:-mac}"

case "$KIND" in
  mac)    QMP=4444; PORTS='5900|4444|10022' ;;
  win)    QMP=4445; PORTS='6900|4445|10023|13389' ;;
  ubuntu) QMP=4446; PORTS='7900|4446|10024' ;;
  *) echo "unknown kind: $KIND" >&2; exit 2 ;;
esac

echo "=== qemu ==="
pgrep -af qemu-system-x86_64 | grep "$QMP" | head -1 || echo "(not running)"

echo "=== ports ==="
ss -tln | grep -E ":($PORTS)" || echo "(none listening)"

echo "=== pid file ==="
cat "/tmp/vmui-$KIND.pid" 2>/dev/null || echo "(no pid file)"

exit 0
