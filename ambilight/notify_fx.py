"""Per-LED notification animations for the DX Light strip (65 LEDs).

The strip runs right (17, bottom->top), top (31, right->left), left (17,
top->bottom) behind the Odyssey. A notification takes the strip over for a
few seconds, then hands it back to the ambilight frames.

One pattern per Copilot event, so the eye knows what happened without
reading a screen:

  ask      insistent: a bright orange "runner" laps the strip fast while the
           rest breathes; repeats until cancelled (max 10 s, like the bulbs).
  done     calm: a green wave rises from the bottom of both sides, meets at
           the top, then fades out. 3 s, once.
  blocked  a red flash from the middle of the top outwards, twice, sharp.
  failed   two amber double-blinks over the whole strip, sharp attack, soft
           release.

Frames are 65*3 bytes in strip order, rendered at FPS by `Animator.frame()`;
the bridge calls it instead of the HyperHDR frame while `active`.

Control: UDP datagram on FX_PORT, JSON {"event":"ask","color":"#ff5a1f",
"duration":10} or {"event":"clear"}. Sent by vmui /api/copilot/event.
"""
from __future__ import annotations

import colorsys
import json
import math
import time

LED_COUNT = 65
RIGHT = range(0, 17)        # bottom -> top
TOP = range(17, 48)         # right -> left
LEFT = range(48, 65)        # top -> bottom
# 30, not 50: the strip takes 4 HID reports per frame and already runs ~55
# fps from HyperHDR; the wedge of 2026-09-15 23:39 came ~10 min after the
# first 50 fps animation tests. Unproven link, cheap insurance.
FPS = 30
FX_PORT = 19460

# Height 0..1 of every LED (0 = desk level, 1 = top edge) and its position
# along the whole strip 0..1 (right-bottom -> top -> left-bottom).
HEIGHT = [0.0] * LED_COUNT
POS = [0.0] * LED_COUNT
for i in RIGHT:
    HEIGHT[i] = (i + 0.5) / len(RIGHT)
for i in TOP:
    HEIGHT[i] = 1.0
for i in LEFT:
    HEIGHT[i] = 1.0 - (i - LEFT.start + 0.5) / len(LEFT)
for i in range(LED_COUNT):
    POS[i] = (i + 0.5) / LED_COUNT
TOP_MID = (TOP.start + TOP.stop) / 2


def _hex(color: str) -> tuple[int, int, int]:
    h = color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _scale(rgb: tuple[int, int, int], k: float) -> tuple[int, int, int]:
    k = max(0.0, min(1.0, k))
    # perceptual: LEDs look linear-ish only after a gamma
    k = k ** 1.8
    return int(rgb[0] * k), int(rgb[1] * k), int(rgb[2] * k)


def _shift_hue(rgb: tuple[int, int, int], dh: float) -> tuple[int, int, int]:
    h, s, v = colorsys.rgb_to_hsv(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
    r, g, b = colorsys.hsv_to_rgb((h + dh) % 1.0, s, v)
    return int(r * 255), int(g * 255), int(b * 255)


# ---------------------------------------------------------------- patterns
# Each returns per-LED intensity 0..1 (and optionally a colour override) for
# time t (seconds since start). `done`/`blocked`/`failed` end on their own by
# returning None; `ask` loops until duration.

def fx_ask(t: float, base: tuple[int, int, int]) -> list[tuple[int, int, int]] | None:
    lap = 1.2                                  # seconds per lap
    head = (t / lap) % 1.0
    breathe = 0.10 + 0.08 * (0.5 + 0.5 * math.sin(t * 2 * math.pi / 1.5))
    out = []
    for i in range(LED_COUNT):
        d = (POS[i] - head) % 1.0              # distance behind the head
        tail = max(0.0, 1.0 - d / 0.18)        # 18 % of the strip long
        k = max(breathe, tail ** 2)
        out.append(_scale(base, k))
    return out


def fx_done(t: float, base: tuple[int, int, int]) -> list[tuple[int, int, int]] | None:
    dur = 3.0
    if t >= dur:
        return None
    rise = min(1.0, t / 1.4)                   # wave front height 0..1 in 1.4 s
    fade = 1.0 if t < 2.0 else max(0.0, 1.0 - (t - 2.0) / 1.0)
    out = []
    for i in range(LED_COUNT):
        edge = rise * 1.15 - HEIGHT[i]         # >0 once the front passed
        k = 0.0 if edge < 0 else min(1.0, edge / 0.25)
        # a slightly lighter crest right at the front
        crest = math.exp(-((edge - 0.05) ** 2) / 0.004) * 0.6
        col = _shift_hue(base, 0.04 * crest)
        out.append(_scale(col, (k + crest) * fade))
    return out


def fx_blocked(t: float, base: tuple[int, int, int]) -> list[tuple[int, int, int]] | None:
    dur = 1.6
    if t >= dur:
        return None
    ph = (t % 0.8) / 0.8                       # two shots of 0.8 s
    radius = ph * 40                           # LEDs from the top middle
    out = []
    for i in range(LED_COUNT):
        dist = abs(i - TOP_MID)
        k = max(0.0, 1.0 - abs(dist - radius) / 6.0) * (1.0 - ph) ** 0.7
        if ph < 0.08:                          # the initial full flash
            k = max(k, 1.0 - ph / 0.08)
        out.append(_scale(base, k))
    return out


def fx_failed(t: float, base: tuple[int, int, int]) -> list[tuple[int, int, int]] | None:
    dur = 2.4
    if t >= dur:
        return None
    ph = t % 1.2
    # double blink: 0.00-0.12 on, 0.12-0.30 off, 0.30-0.42 on, then release
    if ph < 0.12 or 0.30 <= ph < 0.42:
        k = 1.0
    elif ph < 0.30:
        k = 0.15
    else:
        k = max(0.0, 1.0 - (ph - 0.42) / 0.6) * 0.5
    col = _scale(base, k)
    return [col] * LED_COUNT


PATTERNS = {"ask": fx_ask, "done": fx_done, "blocked": fx_blocked, "failed": fx_failed}
DEFAULT_COLOR = {"ask": "#ff5a1f", "done": "#2ecc71", "blocked": "#ff2d2d", "failed": "#ffc400"}


class Animator:
    """Owns the current notification. `frame()` returns the next 195-byte
    frame or None when nothing is playing."""

    def __init__(self) -> None:
        self.event: str | None = None
        self.color = (0, 0, 0)
        self.t0 = 0.0
        self.until = 0.0
        self._last: bytes | None = None

    @property
    def active(self) -> bool:
        return self.event is not None

    def start(self, event: str, color: str | None = None, duration: float | None = None) -> None:
        if event not in PATTERNS:
            return
        self.event = event
        self.color = _hex(color or DEFAULT_COLOR[event])
        self.t0 = time.monotonic()
        # `ask` loops; cap it like the bulbs so a lost cancel cannot pin the strip
        self.until = self.t0 + (duration if duration is not None else (10.0 if event == "ask" else 60.0))
        print(f"  fx: {event} {color or DEFAULT_COLOR[event]}", flush=True)

    def stop(self) -> None:
        if self.event:
            print(f"  fx: {self.event} end", flush=True)
        self.event = None

    def handle(self, payload: bytes) -> None:
        try:
            msg = json.loads(payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return
        ev = msg.get("event")
        if ev == "clear":
            self.stop()
        elif ev in PATTERNS:
            self.start(ev, msg.get("color"), msg.get("duration"))

    def frame(self) -> bytes | None:
        if not self.event:
            return None
        now = time.monotonic()
        if now >= self.until:
            self.stop()
            return None
        px = PATTERNS[self.event](now - self.t0, self.color)
        if px is None:
            self.stop()
            return None
        return b"".join(bytes(p) for p in px)


def preview(event: str, seconds: float = 4.0) -> None:
    """Print a coarse ASCII strip so a pattern can be eyeballed without hardware."""
    a = Animator()
    a.start(event)
    t0 = time.monotonic()
    while time.monotonic() - t0 < seconds:
        f = a.frame()
        if f is None:
            break
        row = "".join(" .:-=+*#%@"[min(9, max(f[3 * i:3 * i + 3]) * 10 // 256)] for i in range(LED_COUNT))
        print(row, flush=True)
        time.sleep(1 / 12)


if __name__ == "__main__":
    import sys
    preview(sys.argv[1] if len(sys.argv) > 1 else "ask", float(sys.argv[2]) if len(sys.argv) > 2 else 4.0)
