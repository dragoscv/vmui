"""OpenRGB bridge: HyperHDR udpraw frames -> PC RGB via the OpenRGB SDK.

The PC sits under the desk, so its RGB is not a screen border -- it is a
glow that should follow the picture's overall mood. HyperHDR therefore
sends a small number of "LEDs" (screen regions) and this bridge fans each
one out to whole OpenRGB zones.

Why not the E1.31 receiver plugin: it needs a plugin build matching the
exact OpenRGB version and a mouse-driven universe map. The SDK is stable
across versions and this file IS the map, in git.

Frame layout expected from HyperHDR (3 regions, 9 bytes):
  0: left  third of the screen  -> D_LED1 Bottom (case strip)
  1: full  screen average       -> GPU, Motherboard accents
  2: right third of the screen  -> D_LED2 Top (case strip)

Usage:
  python openrgb_bridge.py --list
  python openrgb_bridge.py --test
  python openrgb_bridge.py --listen 19447
"""
from __future__ import annotations

import argparse
import socket
import sys
import time

from openrgb import OpenRGBClient
from openrgb.utils import OpenRGBDisconnected, RGBColor

# zone-name substring -> which HyperHDR region (index into the 3-region frame)
# Names cover both OpenRGB 0.9 ("D_LED1 Bottom", "Motherboard") and 1.0
# ("D_LED1", "LED_C1", "Chipset Accent"). We run 0.9 on purpose: 1.0's
# rewritten Gigabyte driver blanks the ARGB headers on every colour update
# (verified 2026-09-14 with a direct SDK ramp, no other writer) and the case
# strobes; 0.9 is smooth. Do not "upgrade" without re-testing that.
ZONE_MAP: dict[str, int] = {
    "D_LED1": 0,
    "D_LED2": 2,
    "LED_C": 1,
    "Chipset": 1,
    "Motherboard": 1,
    "GPU": 1,
}
# ARGB headers come up with 0 LEDs in 1.0 until told their strip length
# (no-op on 0.9 where the sizes are already right).
ZONE_SIZES: dict[str, int] = {"D_LED1": 30, "D_LED2": 20}
# Devices we never touch. The keyboard is for typing, not for mood; the
# Robobloq strip is HyperHDR's over HID (detector is disabled, belt and braces).
SKIP_DEVICE_TYPES = {"KEYBOARD", "MOUSE", "MOUSEMAT", "HEADSET"}
SKIP_DEVICE_NAMES = ("Robobloq",)
# openrgb-python 0.3.6 negotiates v4 and then blocks forever in
# requestPluginList against OpenRGB 1.0. v3 has everything we use.
PROTOCOL = 3


class PcGlow:
    def __init__(self, host: str = "127.0.0.1", port: int = 6742) -> None:
        self.host, self.port = host, port
        self.connect()

    def connect(self) -> None:
        self.client = OpenRGBClient(self.host, self.port, "vmui-ambilight", protocol_version=PROTOCOL)
        self.targets: list[tuple[object, object, int]] = []  # (device, zone, region)
        for dev in self.client.devices:
            if dev.type.name in SKIP_DEVICE_TYPES or any(n in dev.name for n in SKIP_DEVICE_NAMES):
                continue
            direct = next((m for m in dev.modes if m.name == "Direct"), None)
            if direct is not None and dev.active_mode != direct.id:
                dev.set_mode(direct)
            for zone in dev.zones:
                want = next((n for k, n in ZONE_SIZES.items() if k.lower() in zone.name.lower()), None)
                if want and len(zone.leds) != want:
                    zone.resize(want)
                region = next((r for k, r in ZONE_MAP.items() if k.lower() in zone.name.lower()), None)
                if region is None or not zone.leds:
                    continue
                self.targets.append((dev, zone, region))
        if not self.targets:
            raise SystemExit("no OpenRGB zones matched ZONE_MAP")

    def describe(self) -> None:
        for dev, zone, region in self.targets:
            print(f"  region {region} -> {dev.name} / {zone.name} ({len(zone.leds)} leds)")

    def apply(self, regions: list[tuple[int, int, int]]) -> None:
        try:
            # One UPDATELEDS per device, not one UPDATEZONELEDS per zone: the
            # Gigabyte driver runs SetStripBuiltinEffectState + ApplyEffect on
            # every zone commit, so three commits per frame re-arm the strips
            # three times and the case flashed on each transition.
            per_dev: dict[int, tuple[object, list[RGBColor]]] = {}
            for dev, zone, region in self.targets:
                if id(dev) not in per_dev:
                    per_dev[id(dev)] = (dev, [RGBColor(0, 0, 0)] * len(dev.leds))
                r, g, b = regions[min(region, len(regions) - 1)]
                colors = per_dev[id(dev)][1]
                for led in zone.leds:
                    colors[led.id] = RGBColor(r, g, b)
            for dev, colors in per_dev.values():
                dev.set_colors(colors, fast=True)
        except (OpenRGBDisconnected, ConnectionError, OSError):
            # OpenRGB restarts (profile reload, user closes the tray app,
            # SDK server toggled). Reconnect with backoff; the stream keeps
            # arriving and we simply drop frames until the server is back.
            self._reconnect()

    def _reconnect(self) -> None:
        delay = 1.0
        while True:
            try:
                self.client.disconnect()
            except Exception:
                pass
            try:
                self.connect()
                print("  reconnected to OpenRGB", flush=True)
                return
            except Exception as e:  # noqa: BLE001
                print(f"  OpenRGB unavailable ({e.__class__.__name__}); retry in {delay:.0f}s", flush=True)
                time.sleep(delay)
                delay = min(delay * 2, 15)

    def off(self) -> None:
        self.apply([(0, 0, 0)] * 3)


def run_test(glow: PcGlow) -> None:
    for name, cols in (
        ("all red", [(255, 0, 0)] * 3),
        ("left blue / centre white / right green", [(0, 0, 255), (255, 255, 255), (0, 255, 0)]),
    ):
        print(f"  {name}")
        glow.apply(cols)
        time.sleep(2.5)
    glow.off()


def run_listen(glow: PcGlow, port: int) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", port))
    sock.settimeout(1.0)
    print(f"  listening udp://127.0.0.1:{port} (3 regions = 9 bytes/frame)")
    from dxlight_bridge import IdleGate, idle_config  # same folder, same rules
    idle_rgb, idle_after = idle_config("idleGlowHex")
    gate = IdleGate(bytes(idle_rgb) * 3, idle_after)
    print(f"  idle {idle_rgb} after {idle_after:.0f}s of silence")
    # Case lighting does not need 60 Hz; 20 Hz is invisible to the eye on a
    # diffuse glow and keeps SMBus/USB chatter down.
    min_interval = 1 / 20
    next_at = 0.0

    def apply(frame: bytes) -> None:
        glow.apply([tuple(frame[i : i + 3]) for i in (0, 3, 6)])  # type: ignore[misc]

    while True:
        try:
            data, _ = sock.recvfrom(1024)
        except socket.timeout:
            gate.on_timeout(apply)
            continue
        if len(data) < 9:
            continue
        now = time.monotonic()
        if now < next_at:
            continue
        next_at = now + min_interval
        gate.on_frame(ambient(data[:9]), apply)


def ambient(frame: bytes) -> bytes:
    """Turn a picture-average into a glow colour.

    Region averages of a film are mostly desaturated mid-grey: a dark scene
    with subtitles averages to (40,40,40) and the case shows dim WHITE, which
    reads as 'stuck on'. Two rules per region:
      * chroma boost: push saturation up so the dominant hue survives;
      * luma gate: below LUMA_OFF the glow is off, ramping to full by
        LUMA_FULL, so a dark screen means dark case rather than grey.
    """
    out = bytearray()
    for i in (0, 3, 6):
        r, g, b = frame[i], frame[i + 1], frame[i + 2]
        mx, mn = max(r, g, b), min(r, g, b)
        luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        if mx == 0:
            out += b"\0\0\0"
            continue
        # saturation boost: move each channel away from the mean
        mean = (r + g + b) / 3
        sat = (mx - mn) / mx
        k = 1.0 + SAT_BOOST * (1.0 - sat)
        r2, g2, b2 = (min(255, max(0, mean + (c - mean) * k)) for c in (r, g, b))
        # luma gate
        gain = 0.0 if luma <= LUMA_OFF else min(1.0, (luma - LUMA_OFF) / (LUMA_FULL - LUMA_OFF))
        gain = gain ** 0.6  # perceptual ease-in so mid-dark scenes still glow a little
        # grey has no hue to boost; a grey glow is what reads as "white". Fade
        # it by saturation so only coloured light reaches the case.
        gain *= 0.25 + 0.75 * min(1.0, sat * 2.5)
        out += bytes(int(c * gain) for c in (r2, g2, b2))
    return bytes(out)


# Measured on the Odyssey with a night scene + subtitles: average luma ~0.10,
# which is "black" to the eye; a lit interior ~0.30.
LUMA_OFF = 0.12
LUMA_FULL = 0.35
SAT_BOOST = 1.6


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--listen", type=int, metavar="PORT")
    a = ap.parse_args()
    glow = PcGlow()
    try:
        if a.list:
            glow.describe()
        elif a.test:
            glow.describe()
            run_test(glow)
        elif a.listen:
            glow.describe()
            run_listen(glow, a.listen)
        else:
            ap.print_help()
            return 2
    except KeyboardInterrupt:
        pass
    return 0


if sys.stdout is None:  # pythonw: no console, keep the prints somewhere readable
    import os
    _log = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".copilot-tmp", "service-logs")
    os.makedirs(_log, exist_ok=True)
    sys.stdout = sys.stderr = open(os.path.join(_log, "openrgb-bridge.log"), "a", buffering=1, encoding="utf-8")

if __name__ == "__main__":
    sys.exit(main())
