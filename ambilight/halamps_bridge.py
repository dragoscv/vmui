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
# Tuya device ids + LAN addresses of the Calex bulbs (tinytuya deviceScan
# 2026-09-16, protocol 3.3). Local keys come from the Tuya cloud once and are
# cached next to the credentials; the bulbs are then driven over the LAN in
# ~110-210 ms per write instead of HA -> Tuya cloud MQTT -> bulb (~1-2 s
# visible lag, plus HA's 0.5 s per-call floor).
LAN = {
    "light.moodlight": ("bf3cdaf4d8fcbdd035fzad", "192.168.100.56"),
    "light.ambience_light": ("bfeb17809fe63d1414svni", "192.168.100.55"),
}
KEY_CACHE = os.path.join(os.path.dirname(HERE), ".private", "tuya-local-keys.json")
MIN_INTERVAL_S = 0.25   # LAN: one write is ~200 ms on the Moodlight
HA_INTERVAL_S = 0.5
TRANSITION_S = 0.4
# HA/Tuya only step brightness in 1/255; ignore smaller changes so a static
# scene does not spam the cloud.
MIN_DELTA = 6
# Hand the lamps back (leave them as they are) after this long without frames.
RELEASE_S = 5.0
# Relay hysteresis. A film's quadrant average sits right at the luma gate
# (raw 30-60 -> gated 0-20, measured 2026-09-16 over 15 s: the gate flipped
# 6 times), so a gate-driven relay clicks the bulb every second and it is
# off far more than on. Two rules: once on, a lamp turns OFF only after the
# region has read black for OFF_AFTER_S (a cut to a dark shot is not a
# fade-out); once off, it needs gated max >= WAKE_MIN to come back.
WAKE_MIN = 12
OFF_AFTER_S = 4.0
# Lowest brightness worth switching a bulb on for (1/255 units). The Calex
# bulbs are invisible below ~25 % in a dark room (measured 2026-09-16: blue at
# 6/12/25 % read as OFF, red at 60 % visible), and a film's raw_max is
# typically 60-90 -> 14-21/255 with a plain linear map. So the lit range is
# BRI_MIN..cap, and scene luma picks where inside it.
BRI_MIN = 64


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
        self.dark_since: dict[str, float | None] = {}
        self.lan: dict[str, object] = {}
        self.lan_fail: dict[str, int] = {}
        self._open_lan()

    def _open_lan(self) -> None:
        try:
            import tinytuya  # noqa: PLC0415
        except ImportError:
            return
        keys = self._local_keys()
        for entity, (did, ip) in LAN.items():
            key = keys.get(did)
            if not key:
                continue
            b = tinytuya.BulbDevice(did, ip, key)
            b.set_version(3.3)
            b.set_socketPersistent(True)
            b.set_socketTimeout(0.8)
            self.lan[entity] = b

    def _local_keys(self) -> dict[str, str]:
        try:
            with open(KEY_CACHE, encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            pass
        env = os.path.join(os.path.dirname(HERE), ".private", "credentials.env")
        vals: dict[str, str] = {}
        try:
            with open(env, encoding="utf-8") as fh:
                for line in fh:
                    if "=" in line and not line.lstrip().startswith("#"):
                        k, v = line.split("=", 1)
                        vals[k.strip()] = v.strip().strip('"')
        except OSError:
            return {}
        if not (vals.get("TUYA_ACCESS_ID") and vals.get("TUYA_ACCESS_SECRET")):
            return {}
        try:
            import tinytuya  # noqa: PLC0415
            c = tinytuya.Cloud(apiRegion="eu", apiKey=vals["TUYA_ACCESS_ID"], apiSecret=vals["TUYA_ACCESS_SECRET"])
            keys = {d["id"]: d["key"] for d in c.getdevices() if d.get("key")}
        except Exception as e:  # noqa: BLE001
            print(f"  tuya cloud (local keys): {e}", flush=True)
            return {}
        try:
            with open(KEY_CACHE, "w", encoding="utf-8") as fh:
                json.dump(keys, fh)
        except OSError:
            pass
        return keys

    def describe(self) -> None:
        for e in LAMPS:
            st = self._get(f"/api/states/{e}")
            via = f"LAN {LAN[e][1]}" if e in self.lan else "HA"
            print(f"  {e}: {st.get('state')} bri={st.get('attributes', {}).get('brightness')} via {via}", flush=True)
        print(f"  room brightness cap {self.cap}/255, <= {1 / MIN_INTERVAL_S:g} Hz per lamp", flush=True)

    def _get(self, path: str) -> dict:
        req = urllib.request.Request(f"{self.url}{path}", headers={"Authorization": f"Bearer {self.tok}"})
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.load(r)

    def _call(self, service: str, body: dict) -> None:
        entity = body["entity_id"]
        b = self.lan.get(entity)
        if b is not None and self.lan_fail.get(entity, 0) < 3:
            if self._lan_call(b, entity, service, body):
                return
        self._ha_call(service, body)

    def _lan_call(self, b, entity: str, service: str, body: dict) -> bool:
        # Tuya dps: 20 switch, 21 work_mode, 24 colour_data hhhhssssvvvv
        # (h 0..360, s/v 0..1000). One packet per change; no transition on
        # LAN -- the bulb's own ramp (~150 ms) is the smoothing.
        if service == "turn_off":
            dps = {"20": False}
        else:
            r, g, bb = body["rgb_color"]
            mx = max(r, g, bb) or 1
            mn = min(r, g, bb)
            sat = (mx - mn) / mx
            if mx == r:
                h = (60 * ((g - bb) / (mx - mn)) + 360) % 360 if mx != mn else 0
            elif mx == g:
                h = 60 * ((bb - r) / (mx - mn)) + 120
            else:
                h = 60 * ((r - g) / (mx - mn)) + 240
            v = max(10, min(1000, int(body["brightness"] * 1000 / 255)))
            dps = {"20": True, "21": "colour", "24": "%04x%04x%04x" % (int(h), int(sat * 1000), v)}
        try:
            res = b.set_multiple_values(dps, nowait=False)
        except Exception as e:  # noqa: BLE001
            res = {"Error": str(e)}
        if isinstance(res, dict) and res.get("Error"):
            self.lan_fail[entity] = self.lan_fail.get(entity, 0) + 1
            print(f"  {entity}: lan {res.get('Error')} ({self.lan_fail[entity]}/3)", flush=True)
            return False
        self.lan_fail[entity] = 0
        return True

    def _ha_call(self, service: str, body: dict) -> None:
        req = urllib.request.Request(
            f"{self.url}/api/services/light/{service}", data=json.dumps(body).encode(), method="POST",
            headers={"Authorization": f"Bearer {self.tok}", "Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=5).read()

    def _interval(self, entity: str) -> float:
        return MIN_INTERVAL_S if entity in self.lan and self.lan_fail.get(entity, 0) < 3 else HA_INTERVAL_S

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
            since = self.dark_since.get(entity)
            if since is None:
                self.dark_since[entity] = now
                return
            if now - since < OFF_AFTER_S:
                return
            self._call("turn_off", {"entity_id": entity, "transition": TRANSITION_S})
            self.sent[entity] = None
            self.dark_since[entity] = None
            self.next_ok[entity] = now + self._interval(entity)
            print(f"  {entity}: off", flush=True)
            return
        self.dark_since[entity] = None
        # colour at full chroma, brightness carries the luma (capped)
        colour = tuple(int(c * 255 / mx) for c in rgb)
        lvl = raw_max if raw_max is not None else mx
        span = max(0, self.cap - BRI_MIN)
        bri = min(255, BRI_MIN + int(lvl * span / 255))
        if isinstance(last, tuple) and all(abs(a - b) < MIN_DELTA for a, b in zip(colour, last)) and abs(bri - self._last_bri(entity)) < MIN_DELTA:
            return
        self._call("turn_on", {"entity_id": entity, "rgb_color": list(colour), "brightness": bri, "transition": TRANSITION_S})
        self.sent[entity] = colour
        self._bri = getattr(self, "_bri", {})
        self._bri[entity] = bri
        self.next_ok[entity] = now + self._interval(entity)
        if not isinstance(last, tuple):
            print(f"  {entity}: on {colour} bri {bri}", flush=True)

    def _last_bri(self, entity: str) -> int:
        return getattr(self, "_bri", {}).get(entity, -999)

    def close(self) -> None:
        for b in self.lan.values():
            try:
                b.close()  # type: ignore[attr-defined]
            except Exception:  # noqa: BLE001
                pass


def run_listen(lamps: HaLamps, port: int) -> None:
    from openrgb_bridge import ambient  # same dark->off / chroma rules as the case LEDs
    import threading  # noqa: PLC0415

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", port))
    sock.settimeout(1.0)
    n = len(LAMPS)
    print(f"  listening udp://127.0.0.1:{port} ({n} lamps = {3 * n} bytes/frame)", flush=True)

    # One writer per lamp, "latest wins": a 200 ms Moodlight write must not
    # hold back the Ambience or the next frame. The slot holds the newest
    # (rgb, raw_max); the worker drains it whenever the lamp's interval allows.
    slots: dict[str, tuple | None] = {e: None for e in LAMPS}
    wake = {e: threading.Event() for e in LAMPS}
    lock = threading.Lock()

    def worker(entity: str) -> None:
        while True:
            wake[entity].wait(0.5)
            wake[entity].clear()
            nxt = lamps.next_ok.get(entity, 0.0)
            if time.monotonic() < nxt:
                time.sleep(nxt - time.monotonic())  # newer frames keep replacing the slot meanwhile
            with lock:
                job = slots[entity]
                slots[entity] = None
            if job is None:
                continue
            rgb, raw_max = job
            try:
                lamps.set(entity, rgb, time.monotonic(), raw_max)
            except Exception as ex:  # noqa: BLE001 -- HA/LAN hiccup must not kill the loop
                print(f"  {entity}: {ex}", flush=True)

    for e in LAMPS:
        threading.Thread(target=worker, args=(e,), name=f"halamps-{e}", daemon=True).start()

    last_rx = time.monotonic()
    streaming = False
    while True:
        try:
            data, _ = sock.recvfrom(64)
        except socket.timeout:
            data = b""
        now = time.monotonic()
        if len(data) >= 3 * n:
            last_rx = now
            streaming = True
            for i in range(n):
                raw = bytes(data[3 * i:3 * i + 3])
                e = LAMPS[i]
                with lock:
                    slots[e] = (tuple(ambient(raw * 3)[:3]), max(raw))  # type: ignore[arg-type]
                wake[e].set()
        elif streaming and now - last_rx > RELEASE_S:
            streaming = False
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
