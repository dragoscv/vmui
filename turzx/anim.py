"""Animation primitives for the Turzx renderer: easing, tweened values,
morphing numbers, transitions between full frames, dirty-rect diffing."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

from PIL import Image, ImageChops


# ---------------------------------------------------------------- easing
def ease_out_cubic(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_in_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 0.5 - 0.5 * math.cos(math.pi * t)


def ease_out_back(t: float) -> float:
    t = max(0.0, min(1.0, t))
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_rgb(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(round(lerp(x, y, t))) for x, y in zip(a, b))  # type: ignore[return-value]


# ---------------------------------------------------------------- tween
@dataclass
class Tween:
    """A float that glides toward its target (spring-ish exponential)."""

    value: float = 0.0
    target: float = 0.0
    speed: float = 6.0  # 1/s; higher = snappier

    def set(self, v: float, immediate: bool = False) -> None:
        self.target = v
        if immediate:
            self.value = v

    def step(self, dt: float) -> float:
        k = 1 - math.exp(-self.speed * dt)
        self.value += (self.target - self.value) * k
        if abs(self.target - self.value) < 1e-3:
            self.value = self.target
        return self.value

    @property
    def settled(self) -> bool:
        return self.value == self.target


@dataclass
class Pulse:
    """0..1 sine oscillator for breathing/glow effects."""

    period: float = 2.4
    phase: float = 0.0
    steps: int = 12  # quantised so most frames leave the pixels untouched

    def at(self, t: float) -> float:
        v = 0.5 + 0.5 * math.sin(2 * math.pi * (t / self.period) + self.phase)
        return round(v * self.steps) / self.steps


def qsin(x: float, steps: int = 8) -> float:
    """sin() snapped to `steps` levels per unit — the USB link moves ~360 KB/s,
    so a value that changes every frame is a value that repaints every frame."""
    return round(math.sin(x) * steps) / steps


# ---------------------------------------------------------------- digit morph
@dataclass
class MorphDigit:
    """One character slot that slides the old glyph up and the new one in."""

    char: str = " "
    prev: str = " "
    t: float = 1.0  # 0 = just changed, 1 = settled
    duration: float = 0.45

    def set(self, c: str) -> None:
        if c != self.char:
            self.prev, self.char, self.t = self.char, c, 0.0

    def step(self, dt: float) -> None:
        if self.t < 1.0:
            self.t = min(1.0, self.t + dt / self.duration)

    @property
    def animating(self) -> bool:
        return self.t < 1.0


class MorphText:
    def __init__(self, n: int) -> None:
        self.slots = [MorphDigit() for _ in range(n)]

    def set(self, s: str) -> None:
        s = s.rjust(len(self.slots))[-len(self.slots) :]
        for slot, c in zip(self.slots, s):
            slot.set(c)

    def step(self, dt: float) -> None:
        for s in self.slots:
            s.step(dt)

    @property
    def animating(self) -> bool:
        return any(s.animating for s in self.slots)


# ---------------------------------------------------------------- transitions
def transition(a: Image.Image, b: Image.Image, t: float, kind: str) -> Image.Image:
    """Reveal frame b over a at progress t (0..1).

    Every kind only changes a strip of the screen per frame: the USB link
    moves ~360 KB/s, so a full-frame blend (fade/zoom/slide) costs 0.83 s per
    frame and reads as tearing. Legacy names map onto strip reveals.
    """
    t = max(0.0, min(1.0, t))
    w, h = a.size
    e = ease_in_out(t)
    out = a.copy()
    if kind in ("wipe", "fade"):  # left → right
        cut = int(w * e)
        if cut > 0:
            out.paste(b.crop((0, 0, cut, h)), (0, 0))
        return out
    if kind in ("wipe-down", "slide"):  # top → bottom
        cut = int(h * e)
        if cut > 0:
            out.paste(b.crop((0, 0, w, cut)), (0, 0))
        return out
    if kind in ("curtain", "zoom"):  # centre → edges
        half = int(w / 2 * e)
        if half > 0:
            x0, x1 = w // 2 - half, w // 2 + half
            out.paste(b.crop((x0, 0, x1, h)), (x0, 0))
        return out
    return b


# ---------------------------------------------------------------- dirty rects
def dirty_rects(prev: Image.Image | None, cur: Image.Image, gap: int = 12) -> list[tuple[int, int, int, int]]:
    """Exact dirty rectangles: runs of changed rows, each narrowed to the
    columns that changed. Clean gaps shorter than `gap` rows are absorbed —
    one extra command + USB round-trip costs more than a few identical rows.
    Returns (x0, y0, x1, y1) with exclusive x1/y1."""
    if prev is None or prev.size != cur.size:
        return [(0, 0, cur.width, cur.height)]
    diff = ImageChops.difference(prev, cur).convert("L")
    w, h = cur.size
    _, ys = diff.getprojection()
    runs: list[tuple[int, int]] = []
    y = 0
    while y < h:
        if not ys[y]:
            y += 1
            continue
        y0 = y
        while y < h:
            if ys[y]:
                y += 1
                continue
            nxt = y
            while nxt < h and not ys[nxt]:
                nxt += 1
            if nxt < h and nxt - y < gap:
                y = nxt
                continue
            break
        runs.append((y0, y))
    out: list[tuple[int, int, int, int]] = []
    for y0, y1 in runs:
        bbox = diff.crop((0, y0, w, y1)).getbbox()
        if bbox:
            out.append((bbox[0], y0, bbox[2], y1))
    return out


@dataclass
class Clock:
    """Frame clock with dt clamp so a hiccup does not teleport animations."""

    last: float = field(default_factory=time.perf_counter)

    def tick(self) -> float:
        now = time.perf_counter()
        dt = min(0.1, now - self.last)
        self.last = now
        return dt
