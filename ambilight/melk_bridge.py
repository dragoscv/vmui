"""MELK BLE LED strip (light.led_argb) follows the film: HyperHDR udpraw -> GATT.

The strip is the third room lamp. HA's elkbledom integration reaches it via
the ESPHome BLE proxy with >500 ms per call and a single shared connection,
far too slow for ambilight, so during a film this bridge talks to it straight
from the PC's Bluetooth adapter (bleak, verified 2026-09-15). Only ONE client
can hold the strip: while frames stream we own it; RELEASE_S after the last
frame we disconnect and HA's scripts (movie_mode_off: 3000K desk lamp) own
it again.

Protocol (ELK-BLEDOM / MELK-OA10, char fff3, write without response):
  off      7e 00 04 00 00 00 ff 00 ef
  colour   7e 00 05 03 rr gg bb 00 ef        (whole strip, no per-LED)
  bright   7e 00 01 bb 00 00 00 00 ef        (bb 0..100)
Same ambient() gate and on/off hysteresis as the Calex bulbs.
"""
from __future__ import annotations

import argparse
import asyncio
import socket
import sys
import threading
import time

MAC = "BE:69:83:00:C4:0B"
CHAR = "0000fff3-0000-1000-8000-00805f9b34fb"
MIN_INTERVAL_S = 0.2
MIN_DELTA = 6
RELEASE_S = 5.0
WAKE_MIN = 40
CONNECT_TIMEOUT_S = 15


def cmd_off() -> bytes:
    return bytes.fromhex("7e0004000000ff00ef")


def cmd_on() -> bytes:
    return bytes.fromhex("7e0004010000ff00ef")


def cmd_rgb(r: int, g: int, b: int) -> bytes:
    return bytes([0x7E, 0x00, 0x05, 0x03, r, g, b, 0x00, 0xEF])


def cmd_brightness(pct: int) -> bytes:
    return bytes([0x7E, 0x00, 0x01, max(0, min(100, pct)), 0x00, 0x00, 0x00, 0x00, 0xEF])


class MelkStrip:
    """Owns one BLE connection on a private asyncio loop; connect lazily,
    drop it on release so HA can reach the strip."""

    def __init__(self) -> None:
        from bleak import BleakClient  # noqa: PLC0415 -- import error should fail the factory, not the module

        self._BleakClient = BleakClient
        self.loop = asyncio.new_event_loop()
        threading.Thread(target=self.loop.run_forever, name="melk-ble", daemon=True).start()
        self.client = None
        self.sent: tuple[int, int, int] | None | str = "unknown"
        self.bri = -999
        self.next_ok = 0.0
        self.fails = 0

    def _run(self, coro, timeout: float):
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result(timeout)

    async def _ensure(self) -> None:
        if self.client is not None and self.client.is_connected:
            return
        self.client = self._BleakClient(MAC, timeout=CONNECT_TIMEOUT_S)
        await self.client.connect()
        print(f"  melk: connected {MAC}", flush=True)

    async def _write(self, payload: bytes) -> None:
        await self._ensure()
        await self.client.write_gatt_char(CHAR, payload, response=False)

    def write(self, payload: bytes) -> None:
        try:
            self._run(self._write(payload), CONNECT_TIMEOUT_S + 5)
            self.fails = 0
        except Exception as e:  # noqa: BLE001
            self.fails += 1
            self.client = None
            self.sent = "unknown"
            raise OSError(f"melk ble: {e}") from e

    def describe(self) -> None:
        print(f"  melk strip {MAC} via PC Bluetooth, <= {1 / MIN_INTERVAL_S:g} Hz", flush=True)

    def set(self, rgb: tuple[int, int, int], now: float, raw_max: int | None = None) -> None:
        if now < self.next_ok:
            return
        last = self.sent
        if last is None and 0 < max(rgb) < WAKE_MIN:
            rgb = (0, 0, 0)
        mx = max(rgb)
        if mx == 0:
            if last is None:
                return
            self.write(cmd_off())
            self.sent = None
            self.next_ok = now + MIN_INTERVAL_S
            print("  melk: off", flush=True)
            return
        colour = tuple(int(c * 255 / mx) for c in rgb)
        lvl = raw_max if raw_max is not None else mx
        bri = max(5, min(100, int(lvl * 100 / 255)))
        if isinstance(last, tuple) and all(abs(a - b) < MIN_DELTA for a, b in zip(colour, last)) and abs(bri - self.bri) < MIN_DELTA:
            return
        if not isinstance(last, tuple):
            self.write(cmd_on())
        self.write(cmd_rgb(*colour))
        if abs(bri - self.bri) >= MIN_DELTA:
            self.write(cmd_brightness(bri))
            self.bri = bri
        self.sent = colour  # type: ignore[assignment]
        self.next_ok = now + MIN_INTERVAL_S
        if not isinstance(last, tuple):
            print(f"  melk: on {colour} bri {bri}%", flush=True)

    def release(self) -> None:
        """Hand the strip back to HA: disconnect so elkbledom can connect."""
        c, self.client = self.client, None
        self.sent = "unknown"
        self.bri = -999
        if c is None:
            return
        try:
            self._run(c.disconnect(), 10)
        except Exception as e:  # noqa: BLE001
            print(f"  melk: disconnect {e}", flush=True)
        print("  melk: released to HA", flush=True)

    def close(self) -> None:
        try:
            if self.client is not None:
                self.write(cmd_off())
        finally:
            self.release()


def run_listen(strip: MelkStrip, port: int) -> None:
    from openrgb_bridge import ambient  # noqa: PLC0415

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", port))
    sock.settimeout(1.0)
    print(f"  listening udp://127.0.0.1:{port} (1 region = 3 bytes/frame)", flush=True)

    slot: list[tuple | None] = [None]
    wake = threading.Event()
    lock = threading.Lock()

    def worker() -> None:
        while True:
            wake.wait(0.5)
            wake.clear()
            if time.monotonic() < strip.next_ok:
                time.sleep(strip.next_ok - time.monotonic())
            with lock:
                job, slot[0] = slot[0], None
            if job is None:
                continue
            rgb, raw_max = job
            try:
                strip.set(rgb, time.monotonic(), raw_max)
            except Exception as ex:  # noqa: BLE001
                print(f"  melk: {ex}", flush=True)
                if strip.fails >= 5:
                    raise  # let the supervisor restart the bridge
                time.sleep(2.0)

    threading.Thread(target=worker, name="melk-writer", daemon=True).start()

    last_rx = time.monotonic()
    streaming = False
    while True:
        try:
            data, _ = sock.recvfrom(64)
        except socket.timeout:
            data = b""
        now = time.monotonic()
        if len(data) >= 3:
            last_rx = now
            streaming = True
            raw = bytes(data[:3])
            with lock:
                slot[0] = (tuple(ambient(raw * 3)[:3]), max(raw))  # type: ignore[arg-type]
            wake.set()
        elif streaming and now - last_rx > RELEASE_S:
            streaming = False
            with lock:
                slot[0] = None
            strip.release()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--listen", type=int, metavar="PORT")
    ap.add_argument("--test", action="store_true")
    a = ap.parse_args()
    strip = MelkStrip()
    strip.describe()
    if a.test:
        t = time.monotonic()
        for rgb in ((200, 0, 0), (0, 200, 0), (0, 0, 200), (0, 0, 0)):
            print(f"  {rgb}")
            strip.set(rgb, t, 200)
            t += 10
            time.sleep(2.0)
        strip.release()
        return 0
    if a.listen:
        run_listen(strip, a.listen)
    return 0


if __name__ == "__main__":
    sys.exit(main())
