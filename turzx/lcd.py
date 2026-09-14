"""Turzx / Turing 3.5" 320x480 USB screen — "revision A" protocol.

Enumerates as 1a86:5722 (serial USB35INCHIPSV2) or 1a86:ca21. Despite the
rev-B looking IDs this panel answers only the 6-byte rev A command word (same
as apps/android TuringLcd.kt in selfie-screen, verified 2026-09-14 on COM11):

  byte0..4 pack x, y, ex, ey (10 bits each) ; byte5 = command
  102 clear · 108 off · 109 on · 110 brightness (0 = brightest, 255 = off)
  121 orientation (16-byte form) · 197 display bitmap, then RGB565 LE pixels

The framebuffer is always native portrait 320x480. Landscape is done here by
rotating the rendered 480x320 image, which works on every sub-revision.
"""

from __future__ import annotations

import struct
import time

import serial
from PIL import Image
from serial.tools.list_ports import comports

W, H = 320, 480  # native portrait

CMD_CLEAR = 102
CMD_OFF = 108
CMD_ON = 109
CMD_BRIGHTNESS = 110
CMD_ORIENTATION = 121
CMD_BITMAP = 197

CHUNK = 16384


def find_port() -> str | None:
    for p in comports():
        if p.vid == 0x1A86 and p.pid == 0x5722:
            return p.device
        if (p.serial_number or "").startswith("USB35INCH"):
            return p.device
    return None


def rgb565le(img: Image.Image) -> bytes:
    if img.mode != "RGB":
        img = img.convert("RGB")
    raw = img.tobytes()
    n = len(raw) // 3
    out = bytearray(n * 2)
    r = raw[0::3]
    g = raw[1::3]
    b = raw[2::3]
    for i in range(n):
        v = ((r[i] & 0xF8) << 8) | ((g[i] & 0xFC) << 3) | (b[i] >> 3)
        out[2 * i] = v & 0xFF
        out[2 * i + 1] = v >> 8
    return bytes(out)


class TurzxLcd:
    """Callers draw in `self.w x self.h` (480x320 landscape by default)."""

    def __init__(self, port: str | None = None, landscape: bool = True, flip: bool = False) -> None:
        port = port or find_port()
        if not port:
            raise RuntimeError("Turzx (1a86:5722) not found")
        # write_timeout short: when the panel stalls (it stops ACKing bulk
        # transfers every few minutes under sustained load) we want to notice
        # in ~1 s and resync, not hang the frame loop for 5 s.
        self.ser = serial.Serial(port, 115200, timeout=1, write_timeout=1.5)
        self.landscape = landscape
        self.flip = flip
        self.w, self.h = (480, 320) if landscape else (320, 480)
        self.brightness = 60
        self.sub = 0

    # ---- protocol
    def _cmd(self, cmd: int, x: int = 0, y: int = 0, ex: int = 0, ey: int = 0) -> None:
        self.ser.write(bytes((x >> 2, ((x & 3) << 6) + (y >> 4), ((y & 15) << 4) + (ex >> 6), ((ex & 63) << 2) + (ey >> 8), ey & 255, cmd)))

    def hello(self) -> int:
        self.ser.reset_input_buffer()
        self.ser.write(bytes([69] * 6))
        time.sleep(0.15)
        self.ser.read(64)
        return self.sub

    def init(self, brightness: int = 60) -> None:
        self.hello()
        self._cmd(CMD_CLEAR)
        ori = bytearray(16)
        ori[5] = CMD_ORIENTATION
        ori[6] = 100
        ori[7:11] = struct.pack(">HH", W, H)
        self.ser.write(ori)
        self._cmd(CMD_ON)
        self.set_brightness(brightness)

    def set_orientation(self, landscape: bool, flip: bool = False) -> None:
        self.landscape, self.flip = landscape, flip
        self.w, self.h = (480, 320) if landscape else (320, 480)

    def set_brightness(self, pct: int) -> None:
        pct = max(0, min(100, pct))
        self.brightness = pct
        if pct == 0:
            self._cmd(CMD_OFF)
        else:
            self._cmd(CMD_ON)
            self._cmd(CMD_BRIGHTNESS, int(round(255 - pct * 255 / 100)))

    def off(self) -> None:
        self._cmd(CMD_OFF)

    def close(self) -> None:
        try:
            self.ser.close()
        except Exception:
            pass

    # ---- drawing
    def _to_native(self, img: Image.Image, x: int, y: int) -> tuple[Image.Image, int, int]:
        """Map a logical (landscape) rect onto the portrait framebuffer."""
        w, h = img.size
        if not self.landscape:
            return (img.rotate(180) if self.flip else img), (W - x - w if self.flip else x), (H - y - h if self.flip else y)
        if self.flip:
            # clockwise: logical x → native y (same direction), logical y → native x reversed
            return img.transpose(Image.Transpose.ROTATE_270), W - y - h, x
        # default desk orientation: counter-clockwise, logical x → native y reversed, logical y → native x
        return img.transpose(Image.Transpose.ROTATE_90), y, H - x - w

    def blit(self, img: Image.Image, x: int = 0, y: int = 0) -> int:
        w, h = img.size
        assert 0 <= x and x + w <= self.w and 0 <= y and y + h <= self.h, f"blit {w}x{h}@{x},{y} outside {self.w}x{self.h}"
        nat, nx, ny = self._to_native(img, x, y)
        nw, nh = nat.size
        data = rgb565le(nat)
        # The 6-byte header MUST be its own USB transfer. Concatenating it
        # with the pixel payload (tried 2026-09-14) makes the panel ignore the
        # command entirely — screen stays black while every write is ACKed.
        self._cmd(CMD_BITMAP, nx, ny, nx + nw - 1, ny + nh - 1)
        for i in range(0, len(data), CHUNK):
            self.ser.write(data[i : i + CHUNK])
        return len(data)

    def resync(self) -> None:
        """Recover a panel whose parser lost the command boundary: drain, then
        re-run the init sequence. Cheap enough to do on a schedule."""
        try:
            self.ser.reset_output_buffer()
            self.ser.reset_input_buffer()
        except Exception:
            pass
        # The full init sequence (hello read + CLEAR + orientation + on) is the
        # only thing verified to wake a stalled panel; lighter variants did not.
        self.init(self.brightness)

    def full(self, img: Image.Image) -> int:
        assert img.size == (self.w, self.h), f"{img.size} != {(self.w, self.h)}"
        return self.blit(img, 0, 0)


if __name__ == "__main__":
    from PIL import ImageDraw, ImageFont

    lcd = TurzxLcd()
    print("port", lcd.ser.port)
    lcd.init(80)
    im = Image.new("RGB", (480, 320), (18, 18, 28))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 479, 319), outline=(80, 200, 120), width=4)
    d.rectangle((0, 0, 60, 60), fill=(255, 0, 0))  # top-left marker
    d.text((40, 120), "vmui turzx", font=ImageFont.truetype(r"C:\Windows\Fonts\seguisb.ttf", 64), fill=(124, 156, 255))
    t = time.perf_counter()
    n = lcd.full(im)
    print(f"full {n/1024:.0f} KB in {time.perf_counter()-t:.2f}s")
    t = time.perf_counter()
    lcd.blit(Image.new("RGB", (480, 40), (200, 120, 40)), 0, 280)
    print(f"band 480x40 in {time.perf_counter()-t:.3f}s")
    lcd.close()
