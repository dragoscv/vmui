"""DX Light (Robobloq "PC SYNC Backlight", USB HID 1a86:fe07) bridge.

HyperHDR has no driver for this controller, but its "udpraw" LED device
sends one UDP datagram per frame with raw R,G,B bytes for every LED. This
bridge listens for those datagrams and re-emits them in the controller's
HID protocol, so the strip becomes a first-class HyperHDR output with its
own LED geometry.

Protocol (verified against the open-source hypr-quicklight / rgb-controller
implementations and against this unit):
  * HID output reports, report id 0 + 64 payload bytes, packets chunked.
  * Control frame:  'R' 'B' len msg_id action payload... checksum8
        action 147 payload [0]                init ("openUrl")
        action 135 payload [brightness 0-255]
        action 134 payload [1,85,85,85,65,66,0,0,0,254]  section defaults
  * Per-LED frame:  'S' 'C' len_hi len_lo msg_id 128 (n R G B n)*count checksum8
        n is 1-based. Physical order on this strip: right (bottom->top),
        top (right->left), left (top->bottom) -- 17 + 31 + 17 = 65 LEDs.

Usage:
  python dxlight_bridge.py --test           # red/green/blue sweep, then off
  python dxlight_bridge.py --listen 19446   # HyperHDR udpraw target

Idle: after settings.json `idleAfterSec` (default 20) without a datagram the
strip fades to `idleStripHex` (default off). HyperHDR's own
backgroundEffect is NOT used for this: it flips in after 800 ms without a new
frame, and the DX11 grabber emits no frame while the picture is static, so a
paused film or a still scene flashed idle/picture/idle. Here the last frame
is held and idle only wins after a real silence.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time

SETTINGS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "settings.json")


def idle_config(key: str) -> tuple[tuple[int, int, int], float]:
    """(rgb, seconds) from ambilight/settings.json; `key` = idleStripHex | idleGlowHex."""
    try:
        with open(SETTINGS, encoding="utf-8") as fh:
            s = json.load(fh)
    except (OSError, ValueError):
        s = {}
    h = str(s.get(key, "#000000")).lstrip("#")
    rgb = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)) if len(h) == 6 else (0, 0, 0)
    return rgb, float(s.get("idleAfterSec", 20))


def fade_frames(src: bytes, dst: bytes, steps: int):
    for i in range(1, steps + 1):
        t = i / steps
        yield bytes(int(a + (b - a) * t) for a, b in zip(src, dst))


def is_black(data: bytes) -> bool:
    return not any(data)


class IdleGate:
    """Shared idle policy for the UDP bridges.

    HyperHDR emits ONE all-black frame when it switches the LED device off
    (no source / grabber stopped) and then goes silent. Applying that frame
    is the short flash seen on every idle transition: lit -> black -> (20 s
    later) fade to idle red. Rule: a black frame after real content is not
    content, it is the off signal -> keep the last picture and let the idle
    timer run. Leaving idle is faded too, so the first film frame does not
    pop out of solid red.
    """

    def __init__(self, idle_frame: bytes, idle_after: float, steps: int = 40) -> None:
        self.idle_frame = idle_frame
        self.idle_after = idle_after
        self.steps = steps
        self.last: bytes | None = None
        self.last_rx = time.monotonic()
        self.idle = False

    def on_timeout(self, apply) -> None:
        if not self.idle and time.monotonic() - self.last_rx >= self.idle_after and self.last != self.idle_frame:
            for f in fade_frames(self.last or bytes(len(self.idle_frame)), self.idle_frame, self.steps):
                apply(f)
                time.sleep(0.05)
            self.last = self.idle_frame
            self.idle = True
            print("  idle", flush=True)

    def on_frame(self, data: bytes, apply) -> bool:
        """Returns True if `data` was applied."""
        if is_black(data) and self.last is not None and not self.idle:
            # the off signal, not a picture
            self.last_rx = time.monotonic()
            return False
        was_idle = self.idle
        self.last_rx = time.monotonic()
        self.idle = False
        if data == self.last:
            return False
        if was_idle:
            for f in fade_frames(self.last or bytes(len(data)), data, 20):
                apply(f)
                time.sleep(0.03)
        else:
            apply(data)
        self.last = data
        return True


import hid  # hidapi

VID, PID = 0x1A86, 0xFE07
LED_COUNT = 65
REPORT_SIZE = 64


def _checksum8(data: bytes) -> int:
    return sum(data) & 0xFF


class DxLight:
    def __init__(self, brightness: int = 255) -> None:
        self._msg_id = 0
        self.dev = self._open()
        self._init(brightness)

    @staticmethod
    def _open() -> hid.device:
        candidates = [d for d in hid.enumerate(VID, PID) if d["interface_number"] == 0]
        if not candidates:
            raise SystemExit("DX Light not found (1a86:fe07 interface 0). Is it plugged in?")
        dev = hid.device()
        dev.open_path(candidates[0]["path"])
        dev.set_nonblocking(False)
        return dev

    def _next_id(self) -> int:
        self._msg_id = (self._msg_id + 1) & 0xFF
        return self._msg_id

    def _write(self, packet: bytes) -> None:
        for off in range(0, len(packet), REPORT_SIZE):
            chunk = packet[off : off + REPORT_SIZE]
            report = bytes([0x00]) + chunk + bytes(REPORT_SIZE - len(chunk))
            if self.dev.write(report) < 0:
                raise OSError("HID write failed")

    def _rb(self, action: int, payload: bytes) -> None:
        body = bytes([ord("R"), ord("B"), 5 + len(payload) + 1, self._next_id(), action]) + payload
        self._write(body + bytes([_checksum8(body)]))

    def _init(self, brightness: int) -> None:
        self._rb(147, b"\x00")
        self._rb(135, bytes([brightness]))
        self._rb(134, bytes([1, 85, 85, 85, 65, 66, 0, 0, 0, 254]))
        self.frame(bytes(LED_COUNT * 3))

    def set_brightness(self, value: int) -> None:
        self._rb(135, bytes([max(0, min(255, value))]))

    def frame(self, rgb: bytes) -> None:
        """rgb: LED_COUNT*3 bytes in strip order."""
        count = min(LED_COUNT, len(rgb) // 3)
        total = 2 + 2 + 1 + 1 + count * 5 + 1
        out = bytearray([ord("S"), ord("C"), (total >> 8) & 0xFF, total & 0xFF, self._next_id(), 128])
        for i in range(count):
            n = i + 1
            out += bytes([n, rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2], n])
        out.append(_checksum8(out))
        self._write(bytes(out))

    def close(self) -> None:
        try:
            self.frame(bytes(LED_COUNT * 3))
        finally:
            self.dev.close()


def run_test(dx: DxLight) -> None:
    for name, col in (("red", (255, 0, 0)), ("green", (0, 255, 0)), ("blue", (0, 0, 255))):
        print(f"  {name}")
        dx.frame(bytes(col) * LED_COUNT)
        time.sleep(1.0)
    print("  chase (shows physical LED order: right -> top -> left)")
    for i in range(LED_COUNT):
        buf = bytearray(LED_COUNT * 3)
        buf[3 * i : 3 * i + 3] = (255, 255, 255)
        dx.frame(bytes(buf))
        time.sleep(0.03)
    print("  off")


def run_listen(dx: DxLight, port: int) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", port))
    sock.settimeout(1.0)
    print(f"  listening udp://127.0.0.1:{port} for {LED_COUNT} LEDs ({LED_COUNT * 3} bytes/frame)")
    idle_rgb, idle_after = idle_config("idleStripHex")
    gate = IdleGate(bytes(idle_rgb) * LED_COUNT, idle_after)
    print(f"  idle {idle_rgb} after {idle_after:.0f}s of silence")
    frames, t0 = 0, time.monotonic()
    while True:
        try:
            data, _ = sock.recvfrom(4096)
        except socket.timeout:
            gate.on_timeout(dx.frame)
            continue
        if len(data) < 3:
            continue
        gate.on_frame(data, dx.frame)
        frames += 1
        if frames % 600 == 0:
            now = time.monotonic()
            print(f"  {frames / (now - t0):.1f} fps", flush=True)
            frames, t0 = 0, now


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--listen", type=int, metavar="PORT")
    ap.add_argument("--brightness", type=int, default=255)
    a = ap.parse_args()
    dx = DxLight(a.brightness)
    try:
        if a.test:
            run_test(dx)
        elif a.listen:
            run_listen(dx, a.listen)
        else:
            ap.print_help()
            return 2
    except KeyboardInterrupt:
        pass
    finally:
        dx.close()
    return 0


if sys.stdout is None:  # pythonw: no console, keep the prints somewhere readable
    import os
    _log = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".copilot-tmp", "service-logs")
    os.makedirs(_log, exist_ok=True)
    sys.stdout = sys.stderr = open(os.path.join(_log, "dxlight-bridge.log"), "a", buffering=1, encoding="utf-8")

if __name__ == "__main__":
    sys.exit(main())
