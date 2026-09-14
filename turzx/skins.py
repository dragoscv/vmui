"""Skins: palette + fonts + panel/header painters shared by every view.

A view never hard-codes a colour or a font; it asks `self.sk`. That is what
lets the same view render as "glass over a photo" or "amber terminal".

Bandwidth rule (link ≈ 365 KB/s): a skin may paint anything on entry, but
per-frame changes must stay small — so no animated backgrounds here; motion
lives in the views and is quantised (anim.Pulse / anim.qsin).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_DIR = r"C:\Windows\Fonts"
_FONTS: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}

FONT_FILES = {
    "sb": "seguisb.ttf",
    "r": "segoeui.ttf",
    "l": "segoeuil.ttf",
    "b": "segoeuib.ttf",
    "mono": "consola.ttf",
    "serif": "georgia.ttf",
    "serifb": "georgiab.ttf",
    "serifi": "georgiai.ttf",
}


def font(size: int, weight: str = "sb") -> ImageFont.FreeTypeFont:
    key = (weight, size)
    f = _FONTS.get(key)
    if f is None:
        f = ImageFont.truetype(f"{FONT_DIR}\\{FONT_FILES[weight]}", size)
        _FONTS[key] = f
    return f


RGB = tuple[int, int, int]


def lerp_rgb(a: RGB, b: RGB, t: float) -> RGB:
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))  # type: ignore[return-value]


@dataclass
class Skin:
    id: str
    bg: RGB
    fg: RGB
    muted: RGB
    accent: RGB
    ok: RGB
    warn: RGB
    bad: RGB
    card: RGB  # flat panel fill when there is no photo behind
    track: RGB  # gauge/bar track
    # fonts
    huge: ImageFont.FreeTypeFont
    big: ImageFont.FreeTypeFont
    mid: ImageFont.FreeTypeFont
    small: ImageFont.FreeTypeFont
    tiny: ImageFont.FreeTypeFont
    mono: ImageFont.FreeTypeFont
    # style knobs
    radius: int = 12
    panel_alpha: int = 0  # >0: panels are translucent RGBA over the background
    outline: RGB | None = None  # neon-style stroke around panels
    glow: bool = False
    scanlines: bool = False
    text_shadow: bool = False  # for text drawn straight onto a photo
    # colour the header underline uses; default accent
    photo_ok: bool = True  # False = skin ignores photo backgrounds (terminal)
    uppercase_labels: bool = False

    # ---- painters -----------------------------------------------------
    def panel(self, c: Image.Image, box: tuple[int, int, int, int], *, radius: int | None = None, fill: RGB | None = None) -> None:
        """A card. Flat in minimal/editorial, translucent in glass, outlined in neon."""
        r = self.radius if radius is None else radius
        if self.panel_alpha > 0:
            layer = Image.new("RGBA", (box[2] - box[0] + 1, box[3] - box[1] + 1), (0, 0, 0, 0))
            ImageDraw.Draw(layer).rounded_rectangle((0, 0, layer.width - 1, layer.height - 1), radius=r, fill=(*(fill or self.card), self.panel_alpha), outline=(*(self.outline or self.card), min(255, self.panel_alpha + 60)) if self.outline else None, width=1)
            c.paste(layer, (box[0], box[1]), layer)
            return
        d = ImageDraw.Draw(c)
        d.rounded_rectangle(box, radius=r, fill=fill or self.card, outline=self.outline, width=2 if self.outline else 0)

    def label(self, s: str) -> str:
        return s.upper() if self.uppercase_labels else s

    def text(self, d: ImageDraw.ImageDraw, xy: tuple[int, int], s: str, f: ImageFont.FreeTypeFont, fill: RGB, **kw) -> None:
        """Text with an optional 1px shadow so it survives a bright photo."""
        if self.text_shadow:
            sx, sy = xy
            d.text((sx + 1, sy + 1), s, font=f, fill=(0, 0, 0), **kw)
        d.text(xy, s, font=f, fill=fill, **kw)

    def header(self, c: Image.Image, title: str, right: str, progress: float) -> None:
        """Title row + the dwell progress bar (full at entry, shrinks to the
        left as the view's time runs out). progress: 1 → 0."""
        d = ImageDraw.Draw(c)
        self.text(d, (22, 14), self.label(title), self.mid, self.fg)
        if right:
            self.text(d, (480 - 22, 20), right, self.small, self.muted, anchor="ra")
        full = 120
        w = max(2, int(full * max(0.0, min(1.0, progress))))
        d.rounded_rectangle((22, 52, 22 + full, 55), radius=2, fill=self.track)
        d.rounded_rectangle((22, 52, 22 + w, 55), radius=2, fill=self.accent)

    def base(self, size: tuple[int, int], photo: Image.Image | None, dim: float, blur: int) -> Image.Image:
        """The canvas a view draws onto: flat colour, or the photo darkened
        so text stays legible. Photos are ignored by skins that opt out."""
        if photo is None or not self.photo_ok:
            c = Image.new("RGB", size, self.bg)
        else:
            c = photo.copy()
            if blur:
                c = c.filter(ImageFilter.GaussianBlur(blur))
            if dim > 0:
                c = Image.blend(c, Image.new("RGB", size, self.bg), dim)
        if self.scanlines:
            d = ImageDraw.Draw(c)
            dark = lerp_rgb(self.bg, (0, 0, 0), 0.5)
            for y in range(0, size[1], 3):
                d.line((0, y, size[0], y), fill=dark)
        return c

    def with_accent(self, accent: RGB) -> "Skin":
        """Skins that follow the user accent take it; fixed-palette skins keep theirs."""
        if self.id in ("terminal",):
            return self
        return Skin(**{**self.__dict__, "accent": accent})


def _fonts(kind: str) -> dict:
    if kind == "serif":
        return dict(huge=font(112, "serif"), big=font(46, "serifb"), mid=font(26, "serifb"), small=font(19, "serif"), tiny=font(15, "serif"), mono=font(17, "mono"))
    if kind == "mono":
        return dict(huge=font(104, "mono"), big=font(44, "mono"), mid=font(24, "mono"), small=font(18, "mono"), tiny=font(14, "mono"), mono=font(17, "mono"))
    if kind == "editorial":
        return dict(huge=font(128, "b"), big=font(56, "b"), mid=font(26, "sb"), small=font(19, "r"), tiny=font(15, "r"), mono=font(18, "mono"))
    return dict(huge=font(118, "l"), big=font(48), mid=font(26), small=font(19, "r"), tiny=font(15, "r"), mono=font(18, "mono"))


def build(skin_id: str, accent: RGB) -> Skin:
    common = dict(ok=(74, 222, 128), warn=(251, 191, 36), bad=(248, 113, 113))
    if skin_id == "glass":
        return Skin("glass", bg=(10, 11, 18), fg=(245, 246, 250), muted=(178, 184, 205), accent=accent, card=(255, 255, 255), track=(255, 255, 255), **common, **_fonts("sans"), radius=14, panel_alpha=38, outline=(255, 255, 255), text_shadow=True)
    if skin_id == "neon":
        return Skin("neon", bg=(4, 4, 10), fg=(240, 240, 255), muted=(120, 126, 160), accent=accent, card=(10, 10, 20), track=(28, 28, 48), **common, **_fonts("sans"), radius=10, outline=accent, glow=True)
    if skin_id == "editorial":
        return Skin("editorial", bg=(18, 18, 20), fg=(250, 250, 250), muted=(140, 140, 148), accent=accent, card=(30, 30, 34), track=(44, 44, 50), **common, **_fonts("editorial"), radius=6, uppercase_labels=True)
    if skin_id == "terminal":
        amber = (255, 176, 0)
        return Skin("terminal", bg=(6, 8, 6), fg=amber, muted=(150, 104, 0), accent=amber, card=(12, 14, 10), track=(40, 30, 6), ok=(120, 255, 120), warn=amber, bad=(255, 90, 60), **_fonts("mono"), radius=0, outline=(90, 62, 0), scanlines=True, photo_ok=False, uppercase_labels=True)
    if skin_id == "paper":
        return Skin("paper", bg=(244, 240, 231), fg=(38, 34, 30), muted=(122, 114, 104), accent=lerp_rgb(accent, (60, 50, 40), 0.35), card=(255, 253, 248), track=(220, 214, 202), ok=(40, 140, 80), warn=(190, 130, 20), bad=(190, 60, 50), **_fonts("serif"), radius=8, outline=(224, 218, 206))
    return Skin("minimal", bg=(14, 15, 22), fg=(236, 238, 245), muted=(128, 134, 155), accent=accent, card=(24, 26, 36), track=(34, 36, 48), **common, **_fonts("sans"), radius=12)
