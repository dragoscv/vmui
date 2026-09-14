"""XuanFang / Turzx 3.5" 320x480 USB screen — hardware revision "B".

Enumerates as 1a86:5722 serial USB35INCHIPSV2 (CDC, 115200). Protocol from
the turing-smart-screen-python project (GPL-3.0, mathoudebine), minimal
re-implementation for one panel:

  HELLO           CA + 6 bytes -> 10-byte reply, last two = sub-revision
  SET_ORIENTATION CB <0 portrait | 1 landscape>
  DISPLAY_BITMAP  CC x0h x0l y0h y0l x1h x1l y1h y1l  then RGB565 LE pixels
  SET_LIGHTING    CD r g b            (flagship only)
  SET_BRIGHTNESS  CE <0..255>          (A11/A12) or <1 off | 0 on> (A01/A02)

Every command is exactly 10 bytes (zero padded). Partial rectangles are
native, so animation = redraw only dirty regions. Landscape 480x320 is
handled by the display itself when orientation = LANDSCAPE.
"""

from __future__ import annotations

import time

import serial
from PIL import Image
from serial.tools.list_ports import comports

CMD_HELLO = 0xCA
CMD_SET_ORIENTATION = 0xCB
CMD_DISPLAY_BITMAP = 0xCC
CMD_SET_LIGHTING = 0xCD
CMD_SET_BRIGHTNESS = 0xCE

PORTRAIT, LANDSCAPE = 0, 1
SUB_A01, SUB_A02, SUB_A11, SUB_A12 = 0xA01, 0xA02, 0xA11, 0xA12


def find_port() -> str | None:
    for p in comports():
        if p.vid == 0x1A86 and p.pid == 0x5722:
            return p.device
        if (p.serial_number or "").startswith("USB35INCH"):
            return p.device
    return None


def rgb565(img: Image.Image) -> bytes:
    """RGB888 -> RGB565 little-endian, row-major."""
    if img.mode != "RGB":
        img = img.convert("RGB")
    raw = img.tobytes()
    out = bytearray(len(raw) // 3 * 2)
    j = 0
    for i in range(0, len(raw), 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
        out[j] = v & 0xFF
        out[j + 1] = v >> 8
        j += 2
    return bytes(out)


class TurzxLcd:
    """Drawn in landscape 480x320."""

    def __init__(self, port: str | None = None) -> None:
        port = port or find_port()
        if not port:
            raise RuntimeError("Turzx (1a86:5722) not found")
        self.ser = serial.Serial(port, 115200, timeout=1, write_timeout=5, rtscts=True)
        self.sub = SUB_A01
        self.w, self.h = 480, 320
        self.brightness = 60

    # ---- protocol
    def _cmd(self, cmd: int, payload: bytes = b"") -> None:
        msg = bytes((cmd,)) + payload
        self.ser.write(msg + b"\x00" * (10 - len(msg)))

    def hello(self) -> int:
        self.ser.reset_input_buffer()
        self._cmd(CMD_HELLO, bytes((0, 0, 0, 0, 0, 0)))
        r = self.ser.read(10)
        if len(r) == 10 and r[0] == CMD_HELLO and r[-1] == CMD_HELLO:
            self.sub = (r[7] << 8) | r[8]
        return self.sub

    def init(self, brightness: int = 60) -> None:
        self.hello()
        self._cmd(CMD_SET_ORIENTATION, bytes((LANDSCAPE,)))
        self.set_brightness(brightness)

    def set_brightness(self, pct: int) -> None:
        pct = max(0, min(100, pct))
        self.brightness = pct
        if self.sub in (SUB_A11, SUB_A12):
            self._cmd(CMD_SET_BRIGHTNESS, bytes((int(pct * 255 / 100),)))
        else:
            self._cmd(CMD_SET_BRIGHTNESS, bytes((1 if pct == 0 else 0,)))

    def set_backlight_rgb(self, r: int, g: int, b: int) -> None:
        if self.sub in (SUB_A02, SUB_A12):
            self._cmd(CMD_SET_LIGHTING, bytes((r, g, b)))

    def off(self) -> None:
        self.set_brightness(0)

    def close(self) -> None:
        try:
            self.ser.close()
        except Exception:
            pass

    # ---- drawing
    def blit(self, img: Image.Image, x: int = 0, y: int = 0) -> None:
        """Draw `img` at (x, y) in landscape coordinates."""
        w, h = img.size
        assert 0 <= x and x + w <= self.w and 0 <= y and y + h <= self.h, f"blit {w}x{h}@{x},{y} outside {self.w}x{self.h}"
        x1, y1 = x + w - 1, y + h - 1
        self._cmd(CMD_DISPLAY_BITMAP, bytes((x >> 8, x & 0xFF, y >> 8, y & 0xFF, x1 >> 8, x1 & 0xFF, y1 >> 8, y1 & 0xFF)))
        data = rgb565(img)
        # write in 4 KB slices: a single huge write() can trip the CDC write timeout
        for i in range(0, len(data), 4096):
            self.ser.write(data[i : i + 4096])

    def full(self, img: Image.Image) -> None:
        assert img.size == (self.w, self.h)
        self.blit(img, 0, 0)


if __name__ == "__main__":
    lcd = TurzxLcd()
    print("port", lcd.ser.port, "sub-rev", hex(lcd.hello()))
    lcd.init(60)
    from PIL import ImageDraw, ImageFont

    im = Image.new("RGB", (480, 320), (18, 18, 28))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 479, 319), outline=(80, 200, 120), width=4)
    d.text((40, 120), "vmui turzx", font=ImageFont.truetype(r"C:\Windows\Fonts\seguisb.ttf", 64), fill=(124, 156, 255))
    t = time.perf_counter()
    lcd.full(im)
    print(f"full {time.perf_counter()-t:.2f}s")
    for i in range(20):
        p = Image.new("RGB", (480, 40), (18, 18, 28))
        ImageDraw.Draw(p).rectangle((i * 22, 8, i * 22 + 40, 32), fill=(255, 120, 60))
        t = time.perf_counter()
        lcd.blit(p, 0, 260)
        if i % 5 == 0:
            print(f"patch 480x40 {(time.perf_counter()-t)*1000:.0f} ms")
    lcd.close()
