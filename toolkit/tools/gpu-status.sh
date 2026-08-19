#!/bin/bash
# Graphics diagnostics — explains why the Simulator entries are greyed out.
# Runs INSIDE the guest.
set -u

echo "=== Metal ==="
/usr/bin/python3 - <<'PY' 2>/dev/null || echo "  (probe failed)"
import ctypes, ctypes.util
p = ctypes.util.find_library('Metal')
if not p:
    print("  Metal framework: NOT FOUND")
else:
    m = ctypes.cdll.LoadLibrary(p)
    m.MTLCreateSystemDefaultDevice.restype = ctypes.c_void_p
    d = m.MTLCreateSystemDefaultDevice()
    print("  default device:", hex(d) if d else "NULL — no GPU")
PY

echo
echo "=== framebuffer driver ==="
ioreg -rc IOFramebuffer -d 1 2>/dev/null | grep -E '"IOClass"|"IOFBMemorySize"' | sed 's/^ */  /'

echo
echo "=== hardware cursor? ==="
if ioreg -rc IOFramebuffer -d 1 2>/dev/null | grep -q '"IOFBCursorInfo" = ()'; then
  echo "  none — the pointer is composited into the framebuffer,"
  echo "  which is why the cursor lags over a remote display."
else
  echo "  present"
fi

echo
echo "=== what this means ==="
echo "  * iOS/iPadOS Simulators need Metal (Xcode 11+) and cannot run."
echo "  * Window borders look square because Tahoe's 1px window stroke is"
echo "    drawn opaque with no GPU to composite it."
echo "  * Fix: GPU passthrough with a macOS-supported AMD card (RX 580 / RX 6600)"
echo "    from a hypervisor that exposes IOMMU. WSL2 cannot do this."
