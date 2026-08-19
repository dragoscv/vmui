#!/bin/bash
# iPhone / iPad simulator control.
#
# Present so the menu is complete and so this works unchanged the day the VM
# gets a real GPU. Today both prerequisites are missing, and the app greys the
# entries out via `requires: [metal, xcode]` — this script is the backstop if
# someone runs it directly.
set -u

TARGET="${1:-list}"

have_xcode() {
  local dev; dev=$(/usr/bin/xcode-select -p 2>/dev/null || true)
  [[ "$dev" == *".app/Contents/Developer" ]]
}

have_metal() {
  /usr/bin/python3 - <<'PY' 2>/dev/null
import ctypes, ctypes.util, sys
p = ctypes.util.find_library('Metal')
if not p: sys.exit(1)
m = ctypes.cdll.LoadLibrary(p)
m.MTLCreateSystemDefaultDevice.restype = ctypes.c_void_p
sys.exit(0 if m.MTLCreateSystemDefaultDevice() else 1)
PY
}

if ! have_xcode; then
  echo "Xcode is not installed."
  echo
  echo "simctl and Simulator.app ship with Xcode, not the Command Line Tools."
  echo "Installing Xcode needs a working Apple ID, and sign-in fails on this VM:"
  echo "the SMBIOS reports serial W00000000001 with an all-zero hardware UUID,"
  echo "so Apple rejects the machine before it checks your credentials."
  exit 1
fi

if ! have_metal; then
  echo "No Metal device."
  echo
  echo "Since Xcode 11 the Simulator renders through Metal. Without a GPU it"
  echo "refuses to launch. Run 'Graphics diagnostics…' for the details."
  exit 1
fi

# --- from here on the machine is actually capable ------------------------

case "$TARGET" in
  list)
    echo "=== installed runtimes ==="
    xcrun simctl list runtimes
    echo
    echo "=== devices ==="
    xcrun simctl list devices available
    ;;
  iphone|ipad)
    if [ "$TARGET" = iphone ]; then pattern='iPhone'; else pattern='iPad'; fi
    # Newest matching device that is actually available.
    udid=$(xcrun simctl list devices available -j 2>/dev/null \
      | /usr/bin/python3 -c "
import json,sys
d = json.load(sys.stdin)['devices']
best = None
for runtime, devs in sorted(d.items()):
    for dev in devs:
        if '$pattern' in dev.get('name','') and dev.get('isAvailable'):
            best = dev['udid']
print(best or '')
")
    if [ -z "$udid" ]; then
      echo "No available $pattern simulator found."
      echo "Install a runtime: Xcode > Settings > Components."
      exit 1
    fi
    echo "booting $TARGET ($udid)…"
    xcrun simctl boot "$udid" 2>/dev/null || echo "  (already booted)"
    open -a Simulator
    echo "done"
    ;;
  stop)
    echo "shutting down all simulators…"
    xcrun simctl shutdown all 2>/dev/null || true
    osascript -e 'tell application "Simulator" to quit' 2>/dev/null || true
    echo "done"
    ;;
  *)
    echo "usage: sim.sh [list|iphone|ipad|stop]"; exit 2 ;;
esac
