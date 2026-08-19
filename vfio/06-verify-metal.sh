#!/usr/bin/env bash
# Step 6 — did it work? Run this INSIDE the guest after it boots with the GPU.
#
# The single question that matters: does MTLCreateSystemDefaultDevice() return
# a device? Everything else — simulators, shadows, hardware cursor, audio —
# follows from that.
set -u

pass() { printf '\033[32m  PASS\033[0m  %s\n' "$*"; }
fail() { printf '\033[31m  FAIL\033[0m  %s\n' "$*"; FAILED=1; }
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
FAILED=0

say "1. which GPU does macOS see?"
system_profiler SPDisplaysDataType 2>/dev/null | grep -E 'Chipset|Vendor|VRAM|Metal|Device ID' | sed 's/^/  /'

say "2. did an accelerated driver bind?"
DRV=$(ioreg -rc IOPCIDevice -d 1 2>/dev/null | grep -oE 'AMDRadeonX[0-9]+' | head -1)
if [ -n "$DRV" ]; then
  pass "$DRV loaded"
else
  # AppleBochVGAFB means we are still on the emulated adapter.
  FB=$(ioreg -rc IOFramebuffer -d 1 2>/dev/null | awk -F'"' '/"IOClass"/{print $4; exit}')
  fail "no AMD driver; framebuffer is ${FB:-unknown}"
  [ "$FB" = AppleBochVGAFB ] && echo "        still the emulated adapter — the passthrough did not take"
fi

say "3. Metal (the decisive test)"
/usr/bin/python3 - <<'PY'
import ctypes, ctypes.util, sys
p = ctypes.util.find_library('Metal')
if not p:
    print("\033[31m  FAIL\033[0m  Metal framework missing"); sys.exit(1)
m = ctypes.cdll.LoadLibrary(p)
m.MTLCreateSystemDefaultDevice.restype = ctypes.c_void_p
d = m.MTLCreateSystemDefaultDevice()
if d:
    print("\033[32m  PASS\033[0m  MTLCreateSystemDefaultDevice ->", hex(d))
else:
    print("\033[31m  FAIL\033[0m  MTLCreateSystemDefaultDevice -> NULL (no GPU)")
    sys.exit(1)
PY
[ $? -eq 0 ] || FAILED=1

say "4. hardware cursor (was missing on the emulated adapter)"
if ioreg -rc IOFramebuffer -d 1 2>/dev/null | grep -q '"IOFBCursorInfo" = ()'; then
  fail "still software — the cursor will keep lagging"
else
  pass "hardware cursor available"
fi

say "5. VRAM"
system_profiler SPDisplaysDataType 2>/dev/null | grep -i 'VRAM' | sed 's/^/  /' \
  || echo "  (not reported)"

say "6. can Simulator run?"
if xcode-select -p 2>/dev/null | grep -q '\.app/Contents/Developer'; then
  pass "Xcode installed"
  xcrun simctl list runtimes 2>/dev/null | head -5 | sed 's/^/    /'
else
  echo "  Xcode not installed yet."
  echo "  It needs a working Apple ID, which needs a real SMBIOS — see 07-smbios.md."
  echo "  With Metal working, that is the only remaining blocker for simulators."
fi

say "verdict"
if [ "$FAILED" = 0 ]; then
  printf '\033[32m  METAL IS WORKING.\033[0m\n'
  echo "  Next: fix the SMBIOS (07-smbios.md), sign in, install Xcode, then"
  echo "  the iPhone/iPad entries in the vmui Toolkit menu will enable themselves"
  echo "  — they gate on exactly these two checks."
else
  printf '\033[31m  NOT WORKING YET.\033[0m\n'
  echo "  Common causes:"
  echo "    * an emulated <video> device is still present in the domain XML"
  echo "    * the GPU's audio function was not passed through"
  echo "    * no display or dummy plug attached to the card"
  echo "    * Navi cards need boot-arg agdpmod=pikera in OpenCore"
  echo "    * device-id spoofing needed for some models (WhateverGreen)"
fi
