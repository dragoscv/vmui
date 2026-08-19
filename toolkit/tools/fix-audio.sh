#!/bin/bash
# Point macOS at the emulated sound card rather than a virtual loopback.
#
# Two things go wrong on this guest:
#  1. BlackHole 16ch (a loopback driver with no speakers) tends to end up as
#     the default output, so audio plays into nothing.
#  2. macOS does not attach a driver to QEMU's cards anyway: usb-audio gets
#     only an AppleUSBAudioControlNub and no streaming engine, and AppleHDA
#     never loads for ich9-intel-hda because OpenCore injects no ACPI HDEF
#     device with a layout-id. Reported here rather than silently "fixed".
set -u

echo "=== output devices macOS currently offers ==="
system_profiler SPAudioDataType 2>/dev/null \
  | grep -E '^ {8}[A-Za-z].*:$' | sed 's/^/  /'

echo
echo "=== QEMU sound card enumerated? ==="
if ioreg -p IOUSB -w0 2>/dev/null | grep -qi 'QEMU USB Audio'; then
  echo "  usb-audio: enumerated"
  ioreg -w0 2>/dev/null | grep -q 'AppleUSBAudioEngine' \
    && echo "    engine: present" \
    || echo "    engine: MISSING — macOS attached only a control nub, so it exposes no output"
fi
if ioreg -c IOPCIDevice -d 1 -w0 2>/dev/null | grep -q 'pci8086,293e'; then
  echo "  ich9-intel-hda: on the PCI bus"
  ioreg -w0 2>/dev/null | grep -q 'AppleHDA' \
    && echo "    AppleHDA: loaded" \
    || echo "    AppleHDA: NOT loaded — needs an ACPI HDEF device with a layout-id from OpenCore"
fi

echo
echo "=== selecting a real output device ==="
SAS=""
for c in /opt/homebrew/bin/SwitchAudioSource /usr/local/bin/SwitchAudioSource; do
  [ -x "$c" ] && { SAS="$c"; break; }
done

if [ -n "$SAS" ]; then
  "$SAS" -a -t output | sed 's/^/    available: /'
  target=$("$SAS" -a -t output | grep -iv blackhole | head -1)
  if [ -n "$target" ]; then
    "$SAS" -t output -s "$target" && echo "  default output -> $target"
  else
    echo "  only BlackHole is available; nothing to switch to"
  fi
else
  echo "  SwitchAudioSource not installed (brew install switchaudio-osx)."
  echo "  Set it by hand: System Settings > Sound > Output."
fi

echo
echo "=== unmute ==="
osascript -e 'set volume output volume 70 without output muted' 2>/dev/null \
  && echo "  volume 70%, unmuted"
