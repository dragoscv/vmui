"""Room lamps via Home Assistant: HyperHDR udpraw frames -> light.turn_on / turn_off.

Replaces HyperHDR's built-in `home_assistant` LED device for the Calex bulbs.
Why: that driver never calls turn_off -- black is sent as rgb (0,0,0) +
brightness 0, which the Tuya firmware ignores, so a black screen (fade to
black, paused on a dark frame, credits) left both lamps WHITE at 60/255. It
also has a hard-coded 500 ms REST timeout that disables the whole device on
one slow reply (measured 2026-09-15).

Frame: one RGB triple per lamp, in LAMPS order (HyperHDR leds = one region
per lamp). Same `ambient()` luma/chroma gate as the case LEDs, so a dark
scene means dark lamps, not grey; a black region turns the lamp OFF and it
comes back on with colour + brightness in the same call (no white pop).

Rate: Tuya cloud bulbs take ~300 ms per call and lag badly if flooded --
one call per lamp per MIN_INTERVAL_S, and only when the value changed.

Never trust HA's reported state for these bulbs: the Moodlight's Tuya
status reporting froze at h=12/v=157 while it visibly followed every
colour command (2026-09-15, verified by eye against cloud writes). The
bridge keeps its own record of what it wrote and decides from that alone.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SETTINGS = os.path.join(HERE, "settings.json")

# Order == HyperHDR leds order on the room instance (see scripts/ambilight.ps1).
LAMPS = ("light.moodlight", "light.ambience_light")
MIN_INTERVAL_S = 0.5
TRANSITION_S = 0.4
# HA/Tuya only step brightness in 1/255; ignore smaller changes so a static
# scene does not spam the cloud.
MIN_DELTA = 6
# Hand the lamps back (leave them as they are) after this long without frames.
RELEASE_S = 5.0
# Relay hysteresis: once off, a lamp needs max(rgb) >= WAKE_MIN (after the
# ambient() gate) to come back, so a scene hovering at the gate does not
# click the bulb on/off every second.
WAKE_MIN = 40
# Lowest brightness worth switching a bulb on for (1/255 units).
BRI_MIN = 12


def _creds() -> tuple[str, str]:
    env = os.path.join(os.path.dirname(HERE), ".private", "credentials.env")
    vals: dict[str, str] = {}
    try:
        with open(env, encoding="utf-8") as fh:
            for line in fh:
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    vals[k.strip()] = v.strip().strip('"')
    except OSError:
        pass
    url = os.environ.get("HA_URL") or vals.get("HA_URL", "")
    tok = os.environ.get("HA_TOKEN") or vals.get("HA_TOKEN", "")
    if not url or not tok:
        raise SystemExit("HA_URL/HA_TOKEN missing (.private/credentials.env)")
    return url.rstrip("/"), tok


def _brightness_cap() -> int:
    try:
        with open(SETTINGS, encoding="utf-8") as fh:
            return int(json.load(fh).get("roomBrightness", 60))
    except (OSError, ValueError):
        return 60


class HaLamps:
    def __init__(self) -> None:
        self.url, self.tok = _creds()
        self.cap = _brightness_cap()
        self.sent: dict[str, tuple[int, int, int] | None] = {}  # last rgb written; None = off
        self.next_ok: dict[str, float] = {}

    def describe(self) -> None:
        for e in LAMPS:
            st = self._get(f"/api/states/{e}")
            print(f"  {e}: {st.get('state')} bri={st.get('attributes', {}).get('brightness')}", flush=True)
        print(f"  room brightness cap {self.cap}/255, <= {1 / MIN_INTERVAL_S:g} Hz per lamp", flush=True)

    def _get(self, path: str) -> dict:
        req = urllib.request.Request(f"{self.url}{path}", headers={"Authorization": f"Bearer {self.tok}"})
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.load(r)

    def _call(self, service: str, body: dict) -> None:
        req = urllib.request.Request(
            f"{self.url}/api/services/light/{service}", data=json.dumps(body).encode(), method="POST",
            headers={"Authorization": f"Bearer {self.tok}", "Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=5).read()

    def set(self, entity: str, rgb: tuple[int, int, int], now: float, raw_max: int | None = None) -> None:
        """`rgb` = ambient()-gated colour (decides on/off and hue); `raw_max` =
        ungated region max, drives brightness -- the gate's luma curve is tuned
        for case LEDs and left a solid orange screen at 9/255."""
        if now < self.next_ok.get(entity, 0.0):
            return
        last = self.sent.get(entity, "unknown")  # unknown = whatever HA left; first frame always writes
        if last is None and 0 < max(rgb) < WAKE_MIN:  # off -> needs a clearly lit region to wake
            rgb = (0, 0, 0)
        mx = max(rgb)
        if mx == 0:
            if last is None:
                return
            self._call("turn_off", {"entity_id": entity, "transition": TRANSITION_S})
            self.sent[entity] = None
            self.next_ok[entity] = now + MIN_INTERVAL_S
            print(f"  {entity}: off", flush=True)
            return
        # colour at full chroma, brightness carries the luma (capped)
        colour = tuple(int(c * 255 / mx) for c in rgb)
        lvl = raw_max if raw_max is not None else mx
        bri = max(BRI_MIN, min(self.cap, int(lvl * self.cap / 255)))
        if isinstance(last, tuple) and all(abs(a - b) < MIN_DELTA for a, b in zip(colour, last)) and abs(bri - self._last_bri(entity)) < MIN_DELTA:
            return
        self._call("turn_on", {"entity_id": entity, "rgb_color": list(colour), "brightness": bri, "transition": TRANSITION_S})
        self.sent[entity] = colour
        self._bri = getattr(self, "_bri", {})
        self._bri[entity] = bri
        self.next_ok[entity] = now + MIN_INTERVAL_S
        if not isinstance(last, tuple):
            print(f"  {entity}: on {colour} bri {bri}", flush=True)

    def _last_bri(self, entity: str) -> int:
        return getattr(self, "_bri", {}).get(entity, -999)

    def close(self) -> None:
        pass


def run_listen(lamps: HaLamps, port: int) -> None:
    from openrgb_bridge import ambient  # same dark->off / chroma rules as the case LEDs

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", port))
    sock.settimeout(1.0)
    n = len(LAMPS)
    print(f"  listening udp://127.0.0.1:{port} ({n} lamps = {3 * n} bytes/frame)", flush=True)
    last_rx = time.monotonic()
    pending: list[tuple[int, int, int]] | None = None
    while True:
        try:
            data, _ = sock.recvfrom(64)
        except socket.timeout:
            data = b""
        now = time.monotonic()
        if len(data) >= 3 * n:
            last_rx = now
            pending = []
            for i in range(n):
                raw = bytes(data[3 * i:3 * i + 3])
                pending.append((tuple(ambient(raw * 3)[:3]), max(raw)))  # type: ignore[arg-type]
        if pending is not None:
            for e, (rgb, raw_max) in zip(LAMPS, pending):
                try:
                    lamps.set(e, rgb, now, raw_max)
                except Exception as ex:  # noqa: BLE001 -- HA hiccup must not kill the loop
                    print(f"  {e}: {ex}", flush=True)
            if now - last_rx > RELEASE_S:
                pending = None
                lamps.sent.clear()  # forget what we wrote: HA scripts own them now; first frame re-syncs
                print("  idle -> released to HA", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--listen", type=int, metavar="PORT")
    ap.add_argument("--test", action="store_true")
    a = ap.parse_args()
    lamps = HaLamps()
    lamps.describe()
    if a.test:
        t = time.monotonic()
        for rgb in ((200, 0, 0), (0, 200, 0), (0, 0, 200), (0, 0, 0)):
            print(f"  {rgb}")
            for e in LAMPS:
                lamps.set(e, rgb, t)
            t += 10
            time.sleep(2.5)
        return 0
    if a.listen:
        run_listen(lamps, a.listen)
    return 0


if __name__ == "__main__":
    sys.exit(main())
