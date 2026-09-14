"""HyperHDR udpraw -> Tuya Cloud: the Desk Light Bar follows the top of the screen.

The bar (Tuya category `dd`, product "Smart Monitor Light Bar") has RGB LEDs
that Home Assistant cannot drive: its `light.turn_on` with hs_color 500s on
this device because HA's Tuya integration sends `control_data`, which the
firmware rejects with "type is incorrect". The bar DOES accept `colour_data`
(HSV, s/v 0..1000) while `work_mode` = "music" -- verified 2026-09-14 with
red/green/blue via tinytuya.Cloud.

  HyperHDR inst 3 "Desk bar (Tuya)"  udpraw :19448  1 LED = top region
      -> this bridge -> Tuya Cloud (EU)  colour_data at <= MAX_HZ

Transport: LAN first (tinytuya protocol 3.3, ~65 ms per write, no quota;
needs TUYA_DESKBAR_IP / _VERSION / _LOCAL_KEY in .private/credentials.env,
written by the one-off cloud lookup), Tuya Cloud as fallback (~0.4 s, 2 Hz
cap). Idle: when frames stop (movie off, grabber off) the bar is put back in
"white" mode so the HA scenes' colour_temp_kelvin calls keep working; the
ambient() gate turns it off on dark scenes exactly like the case LEDs.

Raw DP ids (protocol 3.3): 20 switch_led, 21 work_mode, 22 bright_value,
23 temp_value, 24 colour_data as 12-hex hhhhssssvvvv (h 0-360, s/v 0-1000).

  python deskbar_bridge.py --test          # red / green / blue / off
  python deskbar_bridge.py --listen 19448
"""
from __future__ import annotations

import argparse
import colorsys
import json
import os
import socket
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

DEVICE_ID = "bf965a6835d854af14xkxb"  # Desk Light Bar (Smart Life)
CLOUD_HZ = 2.0  # Tuya free tier: keep well under the per-day quota
LAN_HZ = 10.0  # 65 ms per write measured; 10 Hz leaves the socket idle half the time
MIN_DELTA_CLOUD = 12  # 0..255 per channel; smaller changes are not worth a cloud call
MIN_DELTA_LAN = 3
IDLE_WHITE = {"temp_value": 374, "bright_value": 356}  # what HA left it at
DP = {"switch_led": 20, "work_mode": 21, "bright_value": 22, "temp_value": 23, "colour_data": 24}


def _credentials() -> dict[str, str]:
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
    for k in ("TUYA_ACCESS_ID", "TUYA_ACCESS_SECRET", "TUYA_DESKBAR_IP", "TUYA_DESKBAR_VERSION", "TUYA_DESKBAR_LOCAL_KEY"):
        if os.environ.get(k):
            vals[k] = os.environ[k]
    if not (vals.get("TUYA_DESKBAR_LOCAL_KEY") or (vals.get("TUYA_ACCESS_ID") and vals.get("TUYA_ACCESS_SECRET"))):
        raise SystemExit("Tuya credentials missing (.private/credentials.env)")
    return vals


class DeskBar:
    def __init__(self) -> None:
        import tinytuya  # noqa: PLC0415 -- optional dependency, only this bridge needs it

        v = _credentials()
        self.local = None
        if v.get("TUYA_DESKBAR_LOCAL_KEY") and v.get("TUYA_DESKBAR_IP"):
            self.local = tinytuya.BulbDevice(DEVICE_ID, v["TUYA_DESKBAR_IP"], v["TUYA_DESKBAR_LOCAL_KEY"])
            self.local.set_version(float(v.get("TUYA_DESKBAR_VERSION") or 3.3))
            self.local.set_socketPersistent(True)
            self.local.set_socketTimeout(2)
        self.cloud = (
            tinytuya.Cloud(apiRegion="eu", apiKey=v["TUYA_ACCESS_ID"], apiSecret=v["TUYA_ACCESS_SECRET"])
            if v.get("TUYA_ACCESS_ID") and v.get("TUYA_ACCESS_SECRET")
            else None
        )
        self.lan_failures = 0
        self.music = False
        self.last: tuple[int, int, int] | None = None
        self.on = True

    @property
    def use_lan(self) -> bool:
        return self.local is not None and self.lan_failures < 3

    @property
    def max_hz(self) -> float:
        return LAN_HZ if self.use_lan else CLOUD_HZ

    def describe(self) -> None:
        if self.local is not None:
            st = self.local.status()
            if isinstance(st, dict) and "dps" in st:
                print(f"  Desk Light Bar: LAN {self.local.address} v{self.local.version} work_mode={st['dps'].get('21', '?')}")
                self.music = st["dps"].get("21") == "music"
                self.on = bool(st["dps"].get("20", True))
                return
            print(f"  Desk Light Bar: LAN status failed ({st}), falling back to cloud")
            self.lan_failures = 3
        if self.cloud is None:
            raise RuntimeError("no LAN and no cloud credentials")
        st = self.cloud.getstatus(DEVICE_ID)
        if not isinstance(st, dict) or not st.get("success"):
            raise RuntimeError(f"Tuya getstatus failed: {st}")
        mode = next((x["value"] for x in st["result"] if x["code"] == "work_mode"), "?")
        print(f"  Desk Light Bar: cloud work_mode={mode}")

    def _send(self, cmds: list[dict]) -> bool:
        if self.use_lan:
            dps = {}
            for c in cmds:
                val = c["value"]
                if c["code"] == "colour_data":
                    j = json.loads(val)
                    val = "%04x%04x%04x" % (j["h"], j["s"], j["v"])
                dps[str(DP[c["code"]])] = val
            # Tuya 3.3 firmware holds ONE TCP session: any other client
            # (HA polling, a diagnostic status()) evicts ours. Wait for the
            # reply so a dead socket is seen here and reopened on the next
            # frame instead of failing silently forever.
            r = self.local.set_multiple_values(dps)
            if not isinstance(r, dict) or "Error" in r or "dps" not in r:
                self.lan_failures += 1
                print(f"  lan: {r} ({self.lan_failures}/3)", flush=True)
                try:
                    self.local.close()
                except Exception:  # noqa: BLE001
                    pass
                if self.lan_failures >= 3 and self.cloud is not None:
                    print("  lan: giving up, cloud fallback", flush=True)
                    return self._send(cmds)
                return False
            self.lan_failures = 0
            return True
        if self.cloud is None:
            return False
        r = self.cloud.sendcommand(DEVICE_ID, {"commands": cmds})
        ok = isinstance(r, dict) and bool(r.get("success"))
        if not ok:
            print(f"  tuya: {r}")
        return ok

    def apply(self, rgb: tuple[int, int, int]) -> None:
        r, g, b = rgb
        if max(rgb) < 8:
            if self.on:
                self._send([{"code": "switch_led", "value": False}])
                self.on = False
                self.last = rgb
            return
        min_delta = MIN_DELTA_LAN if self.use_lan else MIN_DELTA_CLOUD
        if self.last is not None and self.on and max(abs(a - c) for a, c in zip(rgb, self.last)) < min_delta:
            return
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        cmds: list[dict] = []
        if not self.on:
            cmds.append({"code": "switch_led", "value": True})
            self.on = True
        if not self.music:
            cmds.append({"code": "work_mode", "value": "music"})
            self.music = True
        cmds.append({"code": "colour_data", "value": json.dumps({"h": int(h * 360), "s": int(s * 1000), "v": int(v * 1000)})})
        if self._send(cmds):
            self.last = rgb

    def release(self) -> None:
        """Back to plain white so HA's colour_temp scenes take effect again."""
        if not self.music and self.on:
            return
        self._send(
            [
                {"code": "switch_led", "value": True},
                {"code": "work_mode", "value": "white"},
                {"code": "temp_value", "value": IDLE_WHITE["temp_value"]},
                {"code": "bright_value", "value": IDLE_WHITE["bright_value"]},
            ]
        )
        self.music = False
        self.on = True
        self.last = None

    def close(self) -> None:
        try:
            self.release()
        except Exception:  # noqa: BLE001
            pass
        if self.local is not None:
            try:
                self.local.close()
            except Exception:  # noqa: BLE001
                pass


def run_test(bar: DeskBar) -> None:
    for name, rgb in (("red", (200, 0, 0)), ("green", (0, 200, 0)), ("blue", (0, 0, 200)), ("off", (0, 0, 0))):
        print(f"  {name}")
        bar.apply(rgb)
        time.sleep(2.5)
    bar.release()
    print("  released to white")


def run_listen(bar: DeskBar, port: int) -> None:
    from openrgb_bridge import ambient  # same dark->off / chroma rules as the case LEDs

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", port))
    sock.settimeout(1.0)
    print(f"  listening udp://127.0.0.1:{port} (1 region = 3 bytes/frame, <= {bar.max_hz:g} Hz via {'LAN' if bar.use_lan else 'cloud'})")
    next_at = 0.0
    last_rx = time.monotonic()
    released = True
    while True:
        try:
            data, _ = sock.recvfrom(64)
        except socket.timeout:
            # HyperHDR sends one black frame then silence when the source goes
            # away; 5 s without frames = movie over -> hand the bar back to HA.
            if not released and time.monotonic() - last_rx > 5:
                bar.release()
                released = True
                print("  idle -> white mode", flush=True)
            continue
        if len(data) < 3:
            continue
        last_rx = time.monotonic()
        if last_rx < next_at:
            continue
        next_at = last_rx + 1 / bar.max_hz
        rgb = tuple(ambient(bytes(data[:3]) * 3)[:3])  # ambient() works on 3 regions; feed one thrice
        bar.apply(rgb)  # type: ignore[arg-type]
        released = False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--listen", type=int, metavar="PORT")
    a = ap.parse_args()
    bar = DeskBar()
    bar.describe()
    if a.test:
        run_test(bar)
    elif a.listen:
        run_listen(bar, a.listen)
    return 0


if __name__ == "__main__":
    sys.exit(main())
