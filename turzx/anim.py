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

    def at(self, t: float) -> float:
        return 0.5 + 0.5 * math.sin(2 * math.pi * (t / self.period) + self.phase)


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
    """Blend frame a -> b at progress t (0..1)."""
    t = max(0.0, min(1.0, t))
    w, h = a.size
    if kind == "fade":
        return Image.blend(a, b, ease_in_out(t))
    if kind == "slide":
        e = ease_out_cubic(t)
        out = Image.new("RGB", a.size)
        dx = int(w * e)
        out.paste(a, (-dx, 0))
        out.paste(b, (w - dx, 0))
        return out
    if kind == "zoom":
        e = ease_in_out(t)
        out = Image.blend(a, b, e)
        s = 1.0 + 0.08 * (1 - e)  # b zooms in from slightly larger
        bw, bh = int(w * s), int(h * s)
        bz = b.resize((bw, bh), Image.BILINEAR).crop(((bw - w) // 2, (bh - h) // 2, (bw - w) // 2 + w, (bh - h) // 2 + h))
        return Image.blend(out, bz, e * 0.6)
    if kind == "wipe":
        e = ease_in_out(t)
        out = a.copy()
        cut = int(w * e)
        if cut > 0:
            out.paste(b.crop((0, 0, cut, h)), (0, 0))
        return out
    return b


# ---------------------------------------------------------------- dirty rects
def dirty_rects(prev: Image.Image | None, cur: Image.Image, tile: int = 40) -> list[tuple[int, int, int, int]]:
    """Coarse tile diff -> merged row-band rectangles worth re-sending."""
    if prev is None or prev.size != cur.size:
        return [(0, 0, cur.width, cur.height)]
    diff = ImageChops.difference(prev, cur).convert("L")
    w, h = cur.size
    rows: list[tuple[int, int, int, int]] = []
    for ty in range(0, h, tile):
        band = diff.crop((0, ty, w, min(h, ty + tile)))
        bbox = band.getbbox()
        if not bbox:
            continue
        x0, _, x1, _ = bbox
        # snap x to tile grid so consecutive frames reuse the same command shape
        x0 = (x0 // tile) * tile
        x1 = min(w, ((x1 + tile - 1) // tile) * tile)
        rows.append((x0, ty, x1, min(h, ty + tile)))
    # merge vertically adjacent bands with overlapping x ranges
    merged: list[list[int]] = []
    for r in rows:
        if merged and merged[-1][3] == r[1] and abs(merged[-1][0] - r[0]) <= tile and abs(merged[-1][2] - r[2]) <= tile:
            m = merged[-1]
            m[0], m[2], m[3] = min(m[0], r[0]), max(m[2], r[2]), r[3]
        else:
            merged.append(list(r))
    return [tuple(m) for m in merged]  # type: ignore[misc]


@dataclass
class Clock:
    """Frame clock with dt clamp so a hiccup does not teleport animations."""

    last: float = field(default_factory=time.perf_counter)

    def tick(self) -> float:
        now = time.perf_counter()
        dt = min(0.1, now - self.last)
        self.last = now
        return dt
