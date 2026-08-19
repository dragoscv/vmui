#!/bin/bash
# One-screen summary of the guest, for the menu-bar app's alert panel.
set -u

printf 'macOS      %s (%s)\n' \
  "$(sw_vers -productVersion)" "$(sw_vers -buildVersion)"
printf 'Model      %s\n' \
  "$(sysctl -n hw.model 2>/dev/null)"
printf 'CPU        %s\n' \
  "$(sysctl -n machdep.cpu.brand_string 2>/dev/null)"
printf 'Cores      %s logical\n' \
  "$(sysctl -n hw.logicalcpu 2>/dev/null)"
printf 'Memory     %s GB\n' \
  "$(( $(sysctl -n hw.memsize) / 1073741824 ))"
printf 'Disk free  %s\n' \
  "$(df -h / | awk 'NR==2{print $4 " of " $2}')"
printf 'Uptime     %s\n' \
  "$(uptime | sed 's/.*up //; s/,[[:space:]]*[0-9]* user.*//')"

echo
printf 'Graphics   %s\n' \
  "$(ioreg -rc IOFramebuffer -d 1 2>/dev/null | awk -F'"' '/"IOClass"/{print $4; exit}')"
printf 'Metal      %s\n' \
  "$(/usr/bin/python3 -c "
import ctypes, ctypes.util
p = ctypes.util.find_library('Metal')
if not p: print('unavailable')
else:
    m = ctypes.cdll.LoadLibrary(p); m.MTLCreateSystemDefaultDevice.restype = ctypes.c_void_p
    print('available' if m.MTLCreateSystemDefaultDevice() else 'none (no GPU)')
" 2>/dev/null)"
printf 'Xcode      %s\n' \
  "$(xcode-select -p 2>/dev/null || echo 'not installed')"

echo
echo 'Remote display'
printf '  SPICE    %s\n' "$(netstat -an 2>/dev/null | grep -c '\.5900.*ESTABLISHED' >/dev/null && echo 'see host' || echo 'see host')"
printf '  ARD/VNC  %s\n' \
  "$(launchctl list 2>/dev/null | grep -q screensharing && echo 'enabled' || echo 'disabled')"
