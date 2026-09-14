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
ZONE_MAP: dict[str, int] = {
    "D_LED1": 0,
    "D_LED2": 2,
    "Motherboard": 1,
    "GPU": 1,
}
# Devices we never touch. The keyboard is for typing, not for mood.
SKIP_DEVICE_TYPES = {"KEYBOARD", "MOUSE", "MOUSEMAT", "HEADSET"}


class PcGlow:
    def __init__(self, host: str = "127.0.0.1", port: int = 6742) -> None:
        self.host, self.port = host, port
        self.connect()

    def connect(self) -> None:
        self.client = OpenRGBClient(self.host, self.port, "vmui-ambilight")
        self.targets: list[tuple[object, object, int]] = []  # (device, zone, region)
        for dev in self.client.devices:
            if dev.type.name in SKIP_DEVICE_TYPES:
                continue
            direct = next((m for m in dev.modes if m.name == "Direct"), None)
            if direct is not None and dev.active_mode != direct.id:
                dev.set_mode(direct)
            for zone in dev.zones:
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
            for dev, zone, region in self.targets:
                r, g, b = regions[min(region, len(regions) - 1)]
                zone.set_color(RGBColor(r, g, b), fast=True)
            for dev in {t[0] for t in self.targets}:
                dev.show()
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
    last: bytes | None = None
    # Case lighting does not need 60 Hz; 20 Hz is invisible to the eye on a
    # diffuse glow and keeps SMBus/USB chatter down.
    min_interval = 1 / 20
    next_at = 0.0
    while True:
        try:
            data, _ = sock.recvfrom(1024)
        except socket.timeout:
            continue
        if len(data) < 9 or data == last:
            continue
        now = time.monotonic()
        if now < next_at:
            continue
        next_at = now + min_interval
        last = data
        glow.apply([tuple(data[i : i + 3]) for i in (0, 3, 6)])  # type: ignore[misc]


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
