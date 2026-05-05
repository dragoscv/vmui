#!/bin/bash
# Realtime stats sampler for vmui local-kvm provider.
# Reads QEMU host process /proc data and emits a single space-separated line.
# Output line shape:
#   OK <pid> <utimeStime> <vmRssKb> <readBytes> <writeBytes> <rxBytes> <txBytes> <clkTck> <uptimeSec> <qemuMem_MiB>
# or "NORUN" if the VM is not running.

set -u

PID="$(cat /tmp/vmui-mac.pid 2>/dev/null || true)"
if [ -z "${PID}" ] || [ ! -d "/proc/${PID}" ]; then
  echo NORUN
  exit 0
fi

# Parse /proc/<pid>/stat: skip everything up to the closing ')' (comm field
# can contain spaces). After that, fields utime (12) + stime (13) and
# starttime (20) — but we only need utime+stime here.
UST="$(awk '{n=index($0,")"); s=substr($0,n+1); split(s,a," "); print a[12]+a[13]}' /proc/${PID}/stat)"
RSS="$(awk '/^VmRSS:/{print $2}' /proc/${PID}/status)"
RB="$(awk '/^read_bytes:/{print $2}' /proc/${PID}/io 2>/dev/null || echo 0)"
WB="$(awk '/^write_bytes:/{print $2}' /proc/${PID}/io 2>/dev/null || echo 0)"
NET="$(awk 'NR>2 && $1!="lo:"{rx+=$2; tx+=$10} END{print rx+0,tx+0}' /proc/net/dev)"
RX="${NET% *}"
TX="${NET#* }"
CLK="$(getconf CLK_TCK)"
UP="$(awk '{print int($1)}' /proc/uptime)"
# QEMU "-m <MiB>" — read configured memory size from the cmdline.
MEM="$(tr '\0' ' ' < /proc/${PID}/cmdline | grep -oE -- '-m [0-9]+' | awk '{print $2}' | head -1)"
MEM="${MEM:-0}"

echo "OK ${PID} ${UST:-0} ${RSS:-0} ${RB:-0} ${WB:-0} ${RX:-0} ${TX:-0} ${CLK:-100} ${UP:-0} ${MEM}"
