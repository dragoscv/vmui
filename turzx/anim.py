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


class Marquee:
    """Text that scrolls horizontally inside a box when it does not fit.

    Pauses at the start, scrolls left at `speed` px/s, pauses at the end,
    snaps back. Position is quantised to whole pixels and advanced only every
    `hold` seconds' worth of pixels, so a still marquee costs zero bandwidth
    and a moving one repaints only its own box. Renders via a cached glyph
    strip so each frame is one crop+paste, not a text() call.
    """

    def __init__(self, speed: float = 36.0, pause: float = 1.6, gap: int = 40) -> None:
        self.speed, self.pause, self.gap = speed, pause, gap
        self.text = ""
        self.t = 0.0
        self.strip: Image.Image | None = None
        self.key: tuple | None = None

    def set(self, text: str) -> None:
        text = " ".join(text.split())  # a marquee is one line; a newline in the source would crash textlength()
        if text != self.text:
            self.text, self.t, self.strip, self.key = text, 0.0, None, None

    def step(self, dt: float) -> None:
        self.t += dt

    def draw(self, canvas: Image.Image, box: tuple[int, int, int, int], font, fill, bg, anchor_left: bool = True) -> None:
        """box = (x0, y0, x1, y1). Text is vertically centred in the box.
        The strip is RGBA, so whatever is under the box (photo, panel) shows
        through — `bg` is only used to key the cache."""
        from PIL import ImageDraw  # local import keeps anim.py free of PIL.ImageDraw at module load

        x0, y0, x1, y1 = box
        bw, bh = x1 - x0, y1 - y0
        key = (font.path, font.size, fill, bg)
        if self.strip is None or self.key != key:
            probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
            tw = int(probe.textlength(self.text, font=font)) + 2
            ascent, descent = font.getmetrics()
            th = ascent + descent
            self.strip = Image.new("RGBA", (max(1, tw), th), (0, 0, 0, 0))
            ImageDraw.Draw(self.strip).text((1, 0), self.text, font=font, fill=(*fill[:3], 255))
            self.key = key
            self.fits = tw <= bw
        strip = self.strip
        # A strip taller than its box would be centred and bleed into the line
        # above; pin it to the box top instead (callers size boxes to the font).
        ty = y0 + (bh - strip.height) // 2 if strip.height <= bh else y0
        import audit
        if audit._active is not None:
            # a marquee owns its box by design; audit the box, not the strip
            audit.note((x0, ty, x1, ty + strip.height), self.text)
        if self.fits:
            region = strip.crop((0, 0, min(strip.width, bw), strip.height))
            canvas.paste(region, (x0 if anchor_left else x1 - strip.width, ty), region)
            return
        travel = strip.width - bw + self.gap // 2
        cycle = self.pause + travel / self.speed + self.pause
        ph = self.t % cycle
        if ph < self.pause:
            off = 0
        elif ph < self.pause + travel / self.speed:
            off = int((ph - self.pause) * self.speed)
        else:
            off = travel
        off = min(off, strip.width - 1)
        view = strip.crop((off, 0, min(strip.width, off + bw), strip.height))
        canvas.paste(view, (x0, ty), view)


@dataclass
class Clock:
    """Frame clock with dt clamp so a hiccup does not teleport animations."""

    last: float = field(default_factory=time.perf_counter)

    def tick(self) -> float:
        now = time.perf_counter()
        dt = min(0.1, now - self.last)
        self.last = now
        return dt
