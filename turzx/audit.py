"""Layout auditor: records every text box a frame draws and flags what a
viewer would call a bug — text off the panel, or two texts overlapping.

Enabled per frame via `begin()`; `Skin.text` and `Marquee.draw` call `note()`
when a collector is active (zero cost otherwise). `report()` returns the
findings; `overlay()` paints them for a screenshot.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from PIL import Image, ImageDraw

W, H = 480, 320
Box = tuple[int, int, int, int]


@dataclass
class Finding:
    kind: str  # "offscreen" | "overlap" | "clipped"
    a: Box
    b: Box | None
    text: str
    other: str = ""

    def __str__(self) -> str:
        if self.kind == "overlap":
            return f"overlap  {self.a} '{self.text[:28]}'  x  {self.b} '{self.other[:28]}'"
        return f"{self.kind:<9}{self.a} '{self.text[:40]}'"


@dataclass
class Collector:
    boxes: list[tuple[Box, str, str]] = field(default_factory=list)  # box, text, tag

    def note(self, box: Box, text: str, tag: str = "") -> None:
        x0, y0, x1, y1 = box
        if x1 <= x0 or y1 <= y0 or not text.strip():
            return
        self.boxes.append(((int(x0), int(y0), int(x1), int(y1)), text, tag))


_active: Collector | None = None


def begin() -> Collector:
    global _active
    _active = Collector()
    return _active


def end() -> None:
    global _active
    _active = None


def note(box: Box, text: str, tag: str = "") -> None:
    if _active is not None:
        _active.note(box, text, tag)


def _inter(a: Box, b: Box) -> int:
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    return max(0, x1 - x0) * max(0, y1 - y0)


def report(c: Collector, *, min_overlap_px: int = 12) -> list[Finding]:
    out: list[Finding] = []
    MARGIN = 6      # the 3.5" bezel hides ~4 px; text this close reads as cut
    for box, text, _ in c.boxes:
        x0, y0, x1, y1 = box
        if x1 > W or y1 > H or x0 < 0 or y0 < 0:
            out.append(Finding("offscreen", box, None, text))
            continue
        if x0 < MARGIN or x1 > W - MARGIN or y1 > H - MARGIN:
            out.append(Finding("clipped", box, None, text))
    for i in range(len(c.boxes)):
        a, ta, tga = c.boxes[i]
        for j in range(i + 1, len(c.boxes)):
            b, tb, tgb = c.boxes[j]
            if tga and tga == tgb and tga.startswith("stack"):
                continue  # deliberate layering (shadow + text, badge on avatar)
            ov = _inter(a, b)
            if ov == 0:
                # same text row, horizontal gap under 3 px: reads as one word
                same_row = min(a[3], b[3]) - max(a[1], b[1]) > 0.6 * min(a[3] - a[1], b[3] - b[1])
                gap = max(b[0] - a[2], a[0] - b[2])
                if same_row and 0 <= gap < 3 and ta.strip() and tb.strip():
                    out.append(Finding("overlap", a, b, ta, f"{tb} (gap {gap}px)"))
                continue
            if ov < min_overlap_px:
                continue
            # a few pixels of ascender/descender kissing is not a bug; a real
            # overlap covers a meaningful share of the smaller box
            small = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
            if ov >= max(min_overlap_px, small * 0.08):
                out.append(Finding("overlap", a, b, ta, tb))
    return out


def overlay(frame: Image.Image, findings: list[Finding], c: Collector | None = None) -> Image.Image:
    out = frame.convert("RGB")
    d = ImageDraw.Draw(out)
    if c is not None:
        for box, _, _ in c.boxes:
            d.rectangle(box, outline=(80, 160, 255), width=1)
    for f in findings:
        col = (255, 60, 60) if f.kind == "overlap" else (255, 170, 0)
        d.rectangle((max(0, f.a[0]), max(0, f.a[1]), min(W - 1, f.a[2]), min(H - 1, f.a[3])), outline=col, width=2)
        if f.b:
            d.rectangle((max(0, f.b[0]), max(0, f.b[1]), min(W - 1, f.b[2]), min(H - 1, f.b[3])), outline=col, width=2)
    return out
