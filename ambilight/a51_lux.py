"""Samsung A51 on the desk (USB) -> room lux -> Home Assistant `sensor.a51_light`.

Read by binary_sensor.room_is_bright (ambilight/ha-scenes.yaml) which prefers
this over the sun while it is fresh (< 30 min). The HA Companion app on the
phone could publish the same sensor, but its light sensor reports only every
15 min and only when the app is alive; adb from the host is deterministic.

The TCS3701 only streams while the screen is on AND adaptive brightness is
enabled (settings system screen_brightness_mode=1) -- the phone runs dashy
full-screen anyway. Value is the last event in `dumpsys sensorservice`.

  python a51_lux.py --once
  python a51_lux.py --listen 0      # loop forever (port unused; bridges.py contract)
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta
import os
import re
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SERIAL = os.environ.get("A51_SERIAL", "R58N94BMLJY")
ENTITY = "sensor.a51_light"
EVERY_S = 60.0


def _creds() -> tuple[str, str]:
    env = os.path.join(os.path.dirname(HERE), ".private", "credentials.env")
    vals: dict[str, str] = {}
    try:
        with open(env, encoding="utf-8") as fh:
            for line in fh:
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    vals[k.strip()] = v.strip()
    except OSError:
        pass
    url, tok = os.environ.get("HA_URL") or vals.get("HA_URL", ""), os.environ.get("HA_TOKEN") or vals.get("HA_TOKEN", "")
    if not url or not tok:
        raise SystemExit("HA_URL / HA_TOKEN missing")
    return url, tok


def adb(*args: str, timeout: float = 15) -> str:
    # pythonw has no console; without CREATE_NO_WINDOW every adb call flashes a terminal window
    r = subprocess.run(["adb", "-s", SERIAL, *args], capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace", creationflags=0x08000000)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip() or f"adb exit {r.returncode}")
    return r.stdout


class A51Lux:
    def __init__(self) -> None:
        self.url, self.tok = _creds()

    def describe(self) -> None:
        model = adb("shell", "getprop", "ro.product.model").strip()
        mode = adb("shell", "settings", "get", "system", "screen_brightness_mode").strip()
        if mode != "1":
            adb("shell", "settings", "put", "system", "screen_brightness_mode", "1")
            mode = "1 (enabled now)"
        # The light sensor only streams while the display is on. It is a desk
        # dashboard on permanent USB power: keep the screen awake on AC/USB
        # (stay_on_while_plugged_in = 7 -> AC|USB|wireless).
        if adb("shell", "settings", "get", "global", "stay_on_while_plugged_in").strip() != "7":
            adb("shell", "settings", "put", "global", "stay_on_while_plugged_in", "7")
        adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
        print(f"  A51 {model} serial={SERIAL} adaptive_brightness={mode}")

    def read(self) -> tuple[float, str] | None:
        """(lux, wall-clock of the event) from the LAST sensor event, or None."""
        dump = adb("shell", "dumpsys", "sensorservice")
        block = dump.split("TCS3701 Light: last", 1)
        if len(block) < 2:
            return None
        events = re.findall(r"\(ts=[\d.]+, wall=([\d\- :.]+)\) ([\d.]+),", block[1].split("\n\n", 1)[0])
        if not events:
            return None
        wall, lux = events[-1]
        return float(lux), wall

    def publish(self, lux: float, sampled_at: str, age_s: float) -> None:
        body = json.dumps(
            {
                "state": f"{lux:.0f}",
                "attributes": {
                    "unit_of_measurement": "lx",
                    "device_class": "illuminance",
                    "state_class": "measurement",
                    "friendly_name": "A51 light",
                    "icon": "mdi:brightness-5",
                    "sampled_at": sampled_at,
                    "age_min": round(age_s / 60),
                    "source": "adb dumpsys sensorservice",
                },
            }
        ).encode()
        req = urllib.request.Request(f"{self.url}/api/states/{ENTITY}", data=body, method="POST", headers={"Authorization": f"Bearer {self.tok}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=6):
            pass

    def once(self) -> None:
        r = self.read()
        if r is None:
            print("  no light events (screen off?)", flush=True)
            return
        lux, wall = r
        # `wall` is the phone's own clock (MM-DD HH:MM:SS.fff); convert to an
        # absolute ISO timestamp so HA can judge freshness from the SAMPLE,
        # not from when we last POSTed. Observed 2026-09-15: the sensor slept
        # from 23:35 to 08:55 (screen off) while we kept re-publishing 10 lx,
        # and the daylight gate stayed off all morning.
        try:
            sampled = datetime.strptime(f"{datetime.now().year}-{wall}", "%Y-%m-%d %H:%M:%S.%f")
            if sampled > datetime.now() + timedelta(hours=1):  # phone wall clock from last year around New Year
                sampled = sampled.replace(year=sampled.year - 1)
        except ValueError:
            sampled = datetime.now()
        age = (datetime.now() - sampled).total_seconds()
        self.publish(lux, sampled.isoformat(timespec="seconds"), age)
        print(f"  {lux:.0f} lx sampled {age / 60:.0f} min ago", flush=True)

    def close(self) -> None:
        pass


def run_listen(dev: A51Lux, _port: int) -> None:
    while True:
        try:
            dev.once()
        except Exception as e:  # noqa: BLE001 -- phone unplugged etc.; keep polling
            print(f"  a51: {e}", flush=True)
        time.sleep(EVERY_S)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--listen", type=int, metavar="PORT")
    a = ap.parse_args()
    dev = A51Lux()
    dev.describe()
    if a.once:
        dev.once()
    elif a.listen is not None:
        run_listen(dev, a.listen)
    return 0


if __name__ == "__main__":
    sys.exit(main())
