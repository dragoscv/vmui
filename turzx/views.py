"""Turzx views — base class, shared painters and the eight core views.
Extra views live in views_extra.py; both register into VIEWS.

Contract: `update(state, dt)` moves tweens, `draw(canvas, t, progress)` paints
onto a canvas the renderer already prepared (skin base + optional photo).
Every colour/font comes from `self.sk` (skins.Skin). Long strings go through
`self.box(...)` (a Marquee) so they scroll inside their slot instead of
overlapping the neighbour."""

from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from anim import Marquee, MorphText, Pulse, Tween, ease_out_back, ease_out_cubic, lerp_rgb, qsin
from skins import RGB, Skin, build as build_skin

W, H = 480, 320
TZ = ZoneInfo("Europe/Bucharest")
BG = (14, 15, 22)  # renderer fallback before a skin exists

DAYS = ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"]
MONTHS = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"]


def hex_rgb(h: str) -> RGB:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def num(x, default=None):
    try:
        v = float(x)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


def celsius(v, unit=None):
    n = num(v)
    if n is None:
        return None
    return (n - 32) / 1.8 if unit == "°F" else n


def fit_text(d: ImageDraw.ImageDraw, s: str, f: ImageFont.FreeTypeFont, max_w: int) -> str:
    if d.textlength(s, font=f) <= max_w:
        return s
    while s and d.textlength(s + "…", font=f) > max_w:
        s = s[:-1]
    return s + "…"


# ---------------------------------------------------------------- shared painters
def gauge_arc(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, value01: float, color, track, width=12) -> None:
    box = (cx - r, cy - r, cx + r, cy + r)
    d.arc(box, 135, 405, fill=track, width=width)
    if value01 > 0:
        d.arc(box, 135, 135 + int(270 * max(0.0, min(1.0, value01))), fill=color, width=width)


def bar(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, value01: float, color, track) -> None:
    d.rounded_rectangle((x, y, x + w, y + h), radius=h // 2, fill=track)
    fw = int(w * max(0.0, min(1.0, value01)))
    if fw > h:
        d.rounded_rectangle((x, y, x + fw, y + h), radius=h // 2, fill=color)


def sparkline(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int], values: list[float], color, width=2, fill_to=None) -> None:
    x0, y0, x1, y1 = box
    vals = [v for v in values if v is not None]
    if len(vals) < 2:
        return
    lo, hi = min(vals), max(vals)
    span = (hi - lo) or 1.0
    pts = [(x0 + i * (x1 - x0) / (len(vals) - 1), y1 - (v - lo) / span * (y1 - y0)) for i, v in enumerate(vals)]
    if fill_to is not None:
        d.polygon([(x0, y1), *pts, (x1, y1)], fill=fill_to)
    d.line(pts, fill=color, width=width, joint="curve")


_GLOW_CACHE: dict[tuple, Image.Image] = {}


def glow(canvas: Image.Image, cx: int, cy: int, r: int, color, alpha: int = 90) -> None:
    """Soft radial glow; quantised inputs + cached sprite so a steady glow is free."""
    r = max(8, int(r) // 4 * 4)
    alpha = int(alpha) // 8 * 8
    color = tuple(int(c) // 8 * 8 for c in tuple(color)[:3])
    key = (r, color, alpha)
    sprite = _GLOW_CACHE.get(key)
    if sprite is None:
        pad = r * 2
        sprite = Image.new("RGBA", (pad * 2, pad * 2), (0, 0, 0, 0))
        ImageDraw.Draw(sprite).ellipse((pad - r, pad - r, pad + r, pad + r), fill=(*color, alpha))
        sprite = sprite.filter(ImageFilter.GaussianBlur(r // 2))
        if len(_GLOW_CACHE) > 64:
            _GLOW_CACHE.clear()
        _GLOW_CACHE[key] = sprite
    pad = sprite.width // 2
    canvas.paste(sprite, (cx - pad, cy - pad), sprite)


def morph_text(d: ImageDraw.ImageDraw, x: int, y: int, mt: MorphText, f: ImageFont.FreeTypeFont, fill, bg, advance: int) -> None:
    """Each slot: old glyph slides up & fades, new glyph slides in from below."""
    for i, s in enumerate(mt.slots):
        sx = x + i * advance
        if s.t >= 1.0:
            d.text((sx, y), s.char, font=f, fill=fill)
            continue
        e = ease_out_cubic(s.t)
        rise = int(28 * e)
        d.text((sx, y - rise), s.prev, font=f, fill=lerp_rgb(fill, bg, e))
        d.text((sx, y + 28 - rise), s.char, font=f, fill=lerp_rgb(bg, fill, e))


# ---------------------------------------------------------------- base
class View:
    id = "view"
    title = ""
    transition = "wipe"
    wants_photo = True  # False: view is unreadable over a photo (dense numbers)

    def __init__(self, accent: RGB) -> None:
        self.accent = accent
        self.sk: Skin = build_skin("minimal", accent)
        self.options: dict = {}
        self.t0 = time.perf_counter()
        self.dt = 0.0
        self._boxes: dict[str, Marquee] = {}

    # renderer hooks
    def configure(self, skin_id: str, accent: RGB, options: dict) -> None:
        self.accent = accent
        self.sk = build_skin(skin_id, accent)
        self.options = options or {}

    def enter(self) -> None:
        self.t0 = time.perf_counter()
        for m in self._boxes.values():
            m.t = 0.0

    def visible(self, st: dict) -> bool:
        """False = skip this view in the rotation right now (e.g. media idle)."""
        return True

    def update(self, st: dict, dt: float) -> None: ...

    def draw(self, c: Image.Image, t: float, progress: float) -> None: ...

    # helpers
    def box(self, key: str, text: str, speed: float = 36.0) -> Marquee:
        m = self._boxes.get(key)
        if m is None:
            m = self._boxes[key] = Marquee(speed=speed)
        m.set(text)
        m.step(self.dt)
        return m

    def tick(self, dt: float) -> None:
        self.dt = dt

    def header(self, c: Image.Image, title: str, right: str, progress: float) -> None:
        self.sk.header(c, title, right, progress)

    # background colour under text: panel colour if we are on a panel, else skin bg.
    def bgc(self) -> RGB:
        return self.sk.bg


# ---------------------------------------------------------------- 1. clock
class ClockView(View):
    id, title = "clock", "Ceas"

    def __init__(self, accent):
        super().__init__(accent)
        self.hhmm = MorphText(5)
        self.sec = MorphText(2)
        self.temp_in = Tween(speed=2.5); self.temp_out = Tween(speed=2.5); self.hum = Tween(speed=2.5)
        self.now = datetime.now(TZ)

    def update(self, st, dt):
        self.tick(dt)
        self.now = datetime.now(TZ)
        self.hhmm.set(self.now.strftime("%H:%M")); self.sec.set(self.now.strftime("%S"))
        self.hhmm.step(dt); self.sec.step(dt)
        i = st.get("inside") or {}
        ti = celsius((i.get("temp") or {}).get("state"), ((i.get("temp") or {}).get("attributes") or {}).get("unit_of_measurement"))
        hu = num((i.get("hum") or {}).get("state"))
        w = st.get("weather") or {}
        to = celsius((w.get("attributes") or {}).get("temperature"), (w.get("attributes") or {}).get("temperature_unit"))
        if ti is not None: self.temp_in.set(ti)
        if hu is not None: self.hum.set(hu)
        if to is not None: self.temp_out.set(to)
        for tw in (self.temp_in, self.temp_out, self.hum): tw.step(dt)

    def draw(self, c, t, progress):
        sk = self.sk
        d = ImageDraw.Draw(c)
        n = self.now
        show_sec = self.options.get("seconds", True)
        if sk.id == "editorial":
            # one dominant number, date as a caption, temps as a footer line
            sk.text(d, (22, 16), sk.label(DAYS[n.weekday()]), sk.small, sk.muted)
            morph_text(d, 18, 60, self.hhmm, sk.huge, sk.fg, self.bgc(), advance=92)
            sk.text(d, (22, 214), f"{n.day} {MONTHS[n.month-1]} {n.year}", sk.mid, sk.accent)
            sk.text(d, (22, 262), f"{self.temp_in.value:.1f}°C · {self.hum.value:.0f}% înăuntru      {self.temp_out.value:.0f}°C afară", sk.small, sk.muted)
            d.rounded_rectangle((22, 52, 22 + int(120 * progress), 55), radius=2, fill=sk.accent)
            return
        if sk.id == "glass":
            sk.panel(c, (16, 70, 464, 232))
        sk.text(d, (22, 18), DAYS[n.weekday()], sk.mid, sk.fg)
        sk.text(d, (22, 52), f"{n.day} {MONTHS[n.month-1]} {n.year}", sk.small, sk.muted)
        # slot width from the widest digit so glyphs never collide, then fit 5 slots + seconds in 436 px
        adv = int(max(d.textlength(ch, font=sk.huge) for ch in "0123456789")) + 2
        adv = min(adv, (W - 44 - 64) // 5)
        tbg = self.bgc() if sk.panel_alpha == 0 else lerp_rgb(sk.bg, sk.card, 0.15)
        morph_text(d, 22, 84, self.hhmm, sk.huge, sk.fg, tbg, advance=adv)
        if show_sec:
            sub = n.microsecond / 1e6
            secfill = lerp_rgb(sk.accent, sk.muted, round((0.5 + 0.5 * math.cos(2 * math.pi * sub)) * 4) / 4)
            morph_text(d, 22 + 5 * adv + 4, 150, self.sec, sk.big, secfill, tbg, advance=28)
        y = 262
        sk.text(d, (22, y), sk.label("înăuntru"), sk.tiny, sk.muted)
        sk.text(d, (22, y + 18), f"{self.temp_in.value:.1f}°C  {self.hum.value:.0f}%", sk.mid, sk.fg)
        sk.text(d, (W - 22, y), sk.label("afară"), sk.tiny, sk.muted, anchor="ra")
        sk.text(d, (W - 22, y + 18), f"{self.temp_out.value:.0f}°C", sk.mid, sk.fg, anchor="ra")
        frac = (n.hour * 3600 + n.minute * 60 + n.second) / 86400
        bar(d, 22, H - 8, W - 44, 4, frac, sk.accent, sk.track)
        # dwell progress replaces the old breathing underline
        d.rounded_rectangle((22, 44, 22 + int(120 * progress), 46), radius=1, fill=sk.accent)


# ---------------------------------------------------------------- 2. weather
class WeatherView(View):
    id, title = "weather", "Vremea"
    RO = {"clear-night": "senin", "sunny": "soare", "cloudy": "înnorat", "partlycloudy": "parțial noros", "fog": "ceață", "hail": "grindină",
          "lightning": "furtună", "lightning-rainy": "furtună cu ploaie", "pouring": "ploaie torențială", "rainy": "ploaie", "snowy": "ninsoare",
          "snowy-rainy": "lapoviță", "windy": "vânt", "windy-variant": "vânt", "exceptional": "extrem"}

    def __init__(self, accent):
        super().__init__(accent)
        self.temp = Tween(speed=2.0); self.hum = Tween(speed=2.0); self.wind = Tween(speed=2.0); self.pres = Tween(speed=2.0)
        self.cond = "unknown"; self.sun = None

    def update(self, st, dt):
        self.tick(dt)
        w = st.get("weather") or {}
        a = w.get("attributes") or {}
        self.cond = w.get("state") or "unknown"
        t = celsius(a.get("temperature"), a.get("temperature_unit"))
        if t is not None: self.temp.set(t)
        if (h := num(a.get("humidity"))) is not None: self.hum.set(h)
        if (ws := num(a.get("wind_speed"))) is not None:
            u = a.get("wind_speed_unit")
            self.wind.set(ws * 1.609 if u == "mph" else ws * 3.6 if u == "m/s" else ws)
        if (p := num(a.get("pressure"))) is not None:
            self.pres.set(p * 33.8639 if a.get("pressure_unit") == "inHg" else p)
        self.sun = st.get("sun")
        for tw in (self.temp, self.hum, self.wind, self.pres): tw.step(dt)

    def _icon(self, c, cx, cy, t):
        d = ImageDraw.Draw(c)
        cond = self.cond
        sunny = cond in ("sunny", "clear-night", "partlycloudy")
        rainy = cond in ("rainy", "pouring", "lightning-rainy", "snowy-rainy")
        cloudy = cond in ("cloudy", "partlycloudy", "fog", "rainy", "pouring", "lightning", "lightning-rainy", "snowy", "snowy-rainy")
        if sunny:
            r = 30 + 3 * Pulse(3.0, steps=3).at(t)
            col = (250, 204, 21) if cond != "clear-night" else (203, 213, 225)
            if self.sk.glow or self.sk.id in ("minimal", "glass"):
                glow(c, cx - 14, cy - 10, 56, col, 70)
            d = ImageDraw.Draw(c)
            d.ellipse((cx - 14 - r, cy - 10 - r, cx - 14 + r, cy - 10 + r), fill=col)
            if cond != "clear-night":
                for k in range(8):
                    ang = round(t * 0.6 * 16) / 16 + k * math.pi / 4
                    x0, y0 = cx - 14 + math.cos(ang) * (r + 10), cy - 10 + math.sin(ang) * (r + 10)
                    x1, y1 = cx - 14 + math.cos(ang) * (r + 20), cy - 10 + math.sin(ang) * (r + 20)
                    d.line((x0, y0, x1, y1), fill=col, width=4)
        if cloudy:
            drift = qsin(t * 0.8, 6) * 6
            ox = cx + 8 + drift
            col = (226, 232, 240) if cond == "partlycloudy" else (148, 163, 184)
            if self.sk.id == "paper": col = (120, 128, 140)
            for (dx, dy, rr) in ((-22, 14, 20), (0, 2, 28), (24, 14, 20)):
                d.ellipse((ox + dx - rr, cy + dy - rr, ox + dx + rr, cy + dy + rr), fill=col)
            d.rounded_rectangle((ox - 40, cy + 12, ox + 42, cy + 34), radius=10, fill=col)
        if rainy:
            for k in range(7):
                ph = (t * 1.6 + k * 0.37) % 1.0
                x = cx - 26 + k * 12 + (k % 2) * 3
                y = cy + 40 + ph * 40
                d.line((x, y, x - 3, y + 10), fill=(96, 165, 250), width=3)
        if cond in ("snowy", "snowy-rainy"):
            for k in range(8):
                ph = (t * 0.6 + k * 0.29) % 1.0
                x = cx - 30 + k * 10 + qsin(t * 2 + k, 4) * 4
                y = cy + 40 + ph * 40
                d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=(241, 245, 249))
        if cond in ("lightning", "lightning-rainy") and (t * 2) % 3 < 0.25:
            d.polygon([(cx + 6, cy + 30), (cx - 8, cy + 62), (cx + 2, cy + 60), (cx - 6, cy + 90), (cx + 14, cy + 52), (cx + 4, cy + 54)], fill=(253, 224, 71))

    def draw(self, c, t, progress):
        sk = self.sk
        self.header(c, "Vremea", "Acasă", progress)
        if sk.panel_alpha:
            sk.panel(c, (220, 70, 464, 300))
        self._icon(c, 110, 160, t)
        d = ImageDraw.Draw(c)
        tv = f"{self.temp.value:.0f}"
        sk.text(d, (236, 78), tv, sk.huge, sk.fg)
        sk.text(d, (236 + d.textlength(tv, font=sk.huge) + 6, 96), "°C", sk.mid, sk.muted)
        # Layout from the bottom up: three metric rows anchored to the panel
        # floor, then the condition in whatever space is left under the big
        # number — shrunk if a tall skin font would otherwise collide.
        rows = [("umiditate", f"{self.hum.value:.0f}%"), ("vânt", f"{self.wind.value:.0f} km/h"), ("presiune", f"{self.pres.value:.0f} hPa")]
        rh = max(sk.small.size, sk.tiny.size) + 6
        y0 = 296 - 3 * rh
        # condition goes between the big number's baseline and the rows; if a
        # skin's huge font leaves no room, it moves right of the number instead
        big_bottom = d.textbbox((236, 78), tv, font=sk.huge, anchor="la")[3]
        cond = self.RO.get(self.cond, self.cond)
        if big_bottom + 4 + sk.small.size + 4 <= y0:
            sk.text(d, (236, big_bottom + 4), fit_text(d, cond, sk.small, 464 - 236 - 8), sk.small, sk.accent)
        else:
            x = int(236 + d.textlength(tv, font=sk.huge) + 6)
            sk.text(d, (x, 96 + sk.mid.size + 6), fit_text(d, cond, sk.tiny, 464 - x - 8), sk.tiny, sk.accent)
        for i, (k, v) in enumerate(rows):
            y = y0 + i * rh
            # label + value share a row: right-align the value, and clip the
            # label so a wide-font skin cannot run into it
            vw = d.textlength(v, font=sk.small)
            sk.text(d, (236, y), fit_text(d, sk.label(k), sk.tiny, int(130 - vw - 6)), sk.tiny, sk.muted)
            sk.text(d, (236 + 130, y), v, sk.small, sk.fg, anchor="ra")
        if self.sun:
            a = self.sun.get("attributes") or {}
            up = self.sun.get("state") == "above_horizon"
            nxt = a.get("next_setting" if up else "next_rising")
            if isinstance(nxt, str):
                try:
                    hh = datetime.fromisoformat(nxt.replace("Z", "+00:00")).astimezone(TZ).strftime("%H:%M")
                    # own right-aligned column, top row, well clear of the values (which end at x=366)
                    sk.text(d, (W - 24, y0), fit_text(d, ("apus " if up else "răsărit ") + hh, sk.tiny, 80), sk.tiny, sk.muted, anchor="ra")
                except ValueError:
                    pass


# ---------------------------------------------------------------- 3. home
class HomeView(View):
    id, title = "home", "Acasă"

    def __init__(self, accent):
        super().__init__(accent)
        self.lights = Tween(speed=3); self.total = 1
        self.rows: list[tuple[str, str, str]] = []
        self.ac = []

    def update(self, st, dt):
        self.tick(dt)
        h = st.get("home") or {}
        self.lights.set(h.get("lightsOn") or 0); self.lights.step(dt)
        self.total = max(1, h.get("lightsTotal") or 1)
        def s(x): return (x or {}).get("state")
        door = s(h.get("door")); pres = s(h.get("presence")); person = s(h.get("person"))
        self.rows = [
            ("Ușa", "DESCHISĂ" if door == "on" else "închisă" if door == "off" else "—", "bad" if door == "on" else "ok"),
            ("Dormitor", "cineva" if pres == "on" else "gol" if pres == "off" else "—", "accent" if pres == "on" else "muted"),
            ("Dragoș", "acasă" if person == "home" else "plecat" if person == "not_home" else (person or "—"), "ok" if person == "home" else "muted"),
        ]
        self.ac = []
        for label, key in (("AC dormitor", "acBedroom"), ("AC living", "acLiving")):
            cst = h.get(key)
            if not cst: self.ac.append((label, "—", None, None)); continue
            a = cst.get("attributes") or {}
            if cst.get("state") == "off": self.ac.append((label, "oprit", None, None)); continue
            self.ac.append((label, cst["state"], celsius(a.get("temperature"), a.get("temperature_unit")), celsius(a.get("current_temperature"), a.get("temperature_unit"))))

    def draw(self, c, t, progress):
        sk = self.sk
        self.header(c, "Acasă", "", progress)
        d = ImageDraw.Draw(c)
        col_of = {"bad": sk.bad, "ok": sk.ok, "accent": sk.accent, "muted": sk.muted}
        if sk.panel_alpha:
            sk.panel(c, (16, 70, 180, 230)); sk.panel(c, (190, 70, 464, 230))
        gauge_arc(d, 92, 150, 52, self.lights.value / self.total, sk.warn if self.lights.value > 0 else sk.muted, sk.track)
        sk.text(d, (92, 142), f"{self.lights.value:.0f}", sk.big, sk.fg, anchor="mm")
        sk.text(d, (92, 176), sk.label(f"din {self.total} lumini"), sk.tiny, sk.muted, anchor="mm")
        y = 78
        for i, (k, v, cn) in enumerate(self.rows):
            col = col_of[cn]
            p = Pulse(2.0, i, steps=6).at(t)
            r = 5 + 2 * p if cn != "muted" else 5
            d.ellipse((208 - r, y + 12 - r, 208 + r, y + 12 + r), fill=col)
            sk.text(d, (224, y), sk.label(k), sk.tiny, sk.muted)
            sk.text(d, (224, y + 16), v, sk.mid if k == "Ușa" else sk.small, sk.fg)
            y += 50
        for i, (label, mode, target, cur) in enumerate(self.ac):
            x = 200 + i * 140
            sk.panel(c, (x, 238, x + 128, 306))
            d = ImageDraw.Draw(c)
            sk.text(d, (x + 12, 246), sk.label(label), sk.tiny, sk.muted)
            if target is None:
                sk.text(d, (x + 12, 266), mode, sk.small, sk.muted)
            else:
                sk.text(d, (x + 12, 262), f"{target:.0f}°C", sk.mid, (96, 165, 250) if mode == "cool" else (251, 146, 60))
                if cur is not None: sk.text(d, (x + 116, 284), f"acum {cur:.1f}°", sk.tiny, sk.muted, anchor="ra")


# ---------------------------------------------------------------- 4. ambilight
class AmbilightView(View):
    id, title = "ambilight", "Ambilight"
    wants_photo = False

    def __init__(self, accent):
        super().__init__(accent)
        self.col = [Tween(speed=5) for _ in range(3)]
        self.bri = Tween(speed=4); self.mode = "—"; self.wall = (255, 255, 255); self.wall_s = 0.0; self.bar_on = False

    def update(self, st, dt):
        self.tick(dt)
        a = st.get("ambilight") or {}
        strip = a.get("strip") or {}
        rgb = (strip.get("attributes") or {}).get("rgb_color")
        if strip.get("state") == "on" and isinstance(rgb, list) and len(rgb) == 3:
            for tw, v in zip(self.col, rgb): tw.set(v)
            self.bri.set((strip.get("attributes") or {}).get("brightness") or 0)
        else:
            for tw in self.col: tw.set(20)
            self.bri.set(0)
        for tw in self.col: tw.step(dt)
        self.bri.step(dt)
        hy = a.get("hyper") or {}
        self.mode = "film" if hy.get("state") == "on" else "oprit" if hy.get("state") == "off" else "—"
        self.wall = hex_rgb(a.get("wallHex") or "#ffffff"); self.wall_s = a.get("wallStrength") or 0
        self.bar_on = (a.get("bar") or {}).get("state") == "on"

    def draw(self, c, t, progress):
        sk = self.sk
        rgb = tuple(int(tw.value) for tw in self.col)
        if sk.id != "paper":
            glow(c, 150, 150, 120, rgb, int(40 + 60 * (self.bri.value / 255)))
        self.header(c, "Ambilight", self.mode, progress)
        d = ImageDraw.Draw(c)
        d.rounded_rectangle((60, 92, 240, 208), radius=8, fill=(8, 8, 12) if sk.id != "paper" else (30, 30, 34), outline=rgb, width=3)
        d.rounded_rectangle((136, 208, 164, 222), radius=3, fill=sk.track)
        d.rounded_rectangle((104, 222, 196, 228), radius=3, fill=sk.track)
        sk.text(d, (276, 84), sk.label("perete"), sk.tiny, sk.muted)
        d.rounded_rectangle((276, 102, 336, 134), radius=8, fill=self.wall)
        sk.text(d, (346, 104), sk.label("compensare"), sk.tiny, sk.muted)
        sk.text(d, (346, 118), f"{int(self.wall_s*100)}%", sk.small, sk.fg)
        sk.text(d, (276, 150), sk.label("bandă MELK"), sk.tiny, sk.muted)
        d.rounded_rectangle((276, 168, 336, 200), radius=8, fill=rgb)
        sk.text(d, (346, 166), f"{rgb[0]},{rgb[1]},{rgb[2]}", sk.mono, sk.fg)
        sk.text(d, (346, 186), f"{self.bri.value/2.55:.0f}%", sk.small, sk.muted)
        sk.text(d, (276, 216), sk.label("bară birou"), sk.tiny, sk.muted)
        sk.text(d, (276, 234), "aprinsă" if self.bar_on else "stinsă", sk.small, sk.ok if self.bar_on else sk.muted)
        for i in range(24):
            hgt = 6 + 14 * (0.5 + 0.5 * qsin(t * 3 + i * 0.5, 4)) * (round(self.bri.value / 255, 1) + 0.15)
            x = 22 + i * 18
            d.rounded_rectangle((x, 300 - hgt, x + 10, 300), radius=3, fill=lerp_rgb(rgb, sk.bg, 0.25))


# ---------------------------------------------------------------- 5. pc
class PcView(View):
    id, title = "pc", "PC"

    def __init__(self, accent):
        super().__init__(accent)
        self.cpu = Tween(speed=4); self.ram = Tween(speed=3); self.gpu = Tween(speed=4); self.gtemp = Tween(speed=2); self.vram = Tween(speed=3)
        self.hist: list[float] = [0.0] * 60
        self.acc = 0.0

    def update(self, st, dt):
        self.tick(dt)
        pc = st.get("pc") or {}
        for tw, k in ((self.cpu, "cpu"), (self.ram, "ram"), (self.gpu, "gpu"), (self.gtemp, "gpuTemp"), (self.vram, "vram")):
            if (v := num(pc.get(k))) is not None: tw.set(v)
            tw.step(dt)
        self.acc += dt
        if self.acc >= 0.5:
            self.acc = 0
            self.hist = self.hist[1:] + [self.cpu.value]

    def draw(self, c, t, progress):
        sk = self.sk
        self.header(c, "PC", str(self.options.get("hostname") or "dragos-pc"), progress)
        d = ImageDraw.Draw(c)
        if sk.panel_alpha:
            sk.panel(c, (16, 70, 464, 232)); d = ImageDraw.Draw(c)
        if sk.id == "editorial":
            # dominant CPU figure, others as a row
            v = self.cpu.value
            sk.text(d, (22, 56), f"{v:.0f}", sk.huge, sk.fg if v < 85 else sk.bad)
            sk.text(d, (22 + d.textlength(f"{v:.0f}", font=sk.huge) + 8, 100), "% CPU", sk.mid, sk.muted)
            for i, (label, tw, suf) in enumerate((("GPU", self.gpu, "%"), ("RAM", self.ram, "%"), ("GPU °C", self.gtemp, "°"), ("VRAM", self.vram, "%"))):
                x = 22 + i * 112
                sk.text(d, (x, 214), sk.label(label), sk.tiny, sk.muted)
                sk.text(d, (x, 230), f"{tw.value:.0f}{suf}", sk.big, sk.fg)
            sparkline(d, (22, 290, W - 22, 312), self.hist, sk.accent)
            return
        cols = (sk.accent, (168, 85, 247), (34, 211, 238)) if sk.id != "terminal" else (sk.accent, sk.accent, sk.accent)
        for i, (label, tw, col, suf) in enumerate((("CPU", self.cpu, cols[0], "%"), ("GPU", self.gpu, cols[1], "%"), ("RAM", self.ram, cols[2], "%"))):
            cx = 90 + i * 150
            v = tw.value
            gauge_arc(d, cx, 150, 54, v / 100, col if v < 85 else sk.bad, sk.track)
            sk.text(d, (cx, 144), f"{v:.0f}", sk.big, sk.fg, anchor="mm")
            sk.text(d, (cx, 176), suf, sk.tiny, sk.muted, anchor="mm")
            sk.text(d, (cx, 214), sk.label(label), sk.small, sk.muted, anchor="mm")
        sparkline(d, (22, 262, W - 22, 300), self.hist, lerp_rgb(sk.accent, sk.bg, 0.2))
        sk.text(d, (22, 236), f"GPU {self.gtemp.value:.0f}°C · VRAM {self.vram.value:.0f}%", sk.tiny, sk.muted)


# ---------------------------------------------------------------- 6. activity
class ActivityView(View):
    id, title = "activity", "Activitate"

    def __init__(self, accent):
        super().__init__(accent)
        self.items: list[dict] = []
        self.seen: dict[str, float] = {}

    def update(self, st, dt):
        self.tick(dt)
        n = int(self.options.get("max") or 6)
        self.items = (st.get("activity") or [])[:n]
        now = time.perf_counter()
        for it in self.items:
            self.seen.setdefault(f"{it.get('at')}|{it.get('text')}", now)

    def draw(self, c, t, progress):
        sk = self.sk
        self.header(c, "Activitate", f"{len(self.items)} evenimente", progress)
        d = ImageDraw.Draw(c)
        y = 74
        now = time.perf_counter()
        for it in self.items:
            key = f"{it.get('at')}|{it.get('text')}"
            age = now - self.seen.get(key, now)
            if age >= 0.6:
                e, alpha = 1.0, 1.0
            else:
                e = ease_out_back(age / 0.6); alpha = min(1.0, age / 0.4)
            x = int(22 + (1 - e) * 60)
            hh = datetime.fromtimestamp((it.get("at") or 0) / 1000, TZ).strftime("%H:%M")
            kind = it.get("kind") or ""
            col = {"assist": (168, 85, 247), "door": sk.warn, "light": (250, 204, 21)}.get(kind, sk.accent)
            if sk.panel_alpha:
                sk.panel(c, (x - 6, y - 6, W - 16, y + 34), radius=8); d = ImageDraw.Draw(c)
            d.rounded_rectangle((x, y, x + 6, y + 34), radius=3, fill=lerp_rgb(sk.bg, col, alpha))
            # time in a fixed-width column on the left, message to its right —
            # stacking them vertically overlapped by 5 px on every skin
            sk.text(d, (x + 16, y + 10), hh, sk.tiny, lerp_rgb(sk.bg, sk.muted, alpha))
            self.box(key, str(it.get("text") or "")).draw(c, (x + 60, y + 4, W - 30, y + 30), sk.small, lerp_rgb(sk.bg, sk.fg, alpha), self.bgc() if not sk.panel_alpha else lerp_rgb(sk.bg, sk.card, 0.15))
            y += 40
        if not self.items:
            sk.text(d, (W // 2, 180), "nimic recent", sk.mid, sk.muted, anchor="mm")


# ---------------------------------------------------------------- 7. media
class MediaView(View):
    id, title = "media", "Redare"

    def __init__(self, accent):
        super().__init__(accent)
        self.m = None; self.others: list[dict] = []; self.pos = Tween(speed=8); self.art = None

    def visible(self, st):
        if not self.options.get("skipIdle"):
            return True
        return any(x.get("state") == "playing" for x in (st.get("media") or []))

    @staticmethod
    def _rank(x: dict) -> tuple:
        # playing beats paused; a real title beats a bare "playing" (TVs on an input)
        return (x.get("state") != "playing", not (x.get("title") or x.get("artist")), str(x.get("id")))

    def update(self, st, dt):
        self.tick(dt)
        ms = sorted((st.get("media") or []), key=self._rank)
        self.m = ms[0] if ms else None
        self.others = ms[1:5]
        if self.m and self.m.get("duration"):
            p = num(self.m.get("position")) or 0
            at = self.m.get("positionAt")
            if self.m.get("state") == "playing" and isinstance(at, str):
                try:
                    p += (datetime.now(timezone.utc) - datetime.fromisoformat(at.replace("Z", "+00:00"))).total_seconds()
                except ValueError:
                    pass
            self.pos.set(min(p, num(self.m.get("duration")) or p))
        self.pos.step(dt)
        arts = st.get("_arts") or {}
        self.art = arts.get((self.m or {}).get("art")) if self.m else None

    def draw(self, c, t, progress):
        sk = self.sk
        n = 1 + len(self.others) if self.m else 0
        self.header(c, "Redare", f"{n} dispozitive" if n > 1 else ((self.m or {}).get("app") or ""), progress)
        d = ImageDraw.Draw(c)
        if not self.m:
            sk.text(d, (W // 2, 180), "nimic în redare", sk.mid, sk.muted, anchor="mm")
            return
        compact = bool(self.others)
        art_sz = 96 if compact else 150
        top = 70 if compact else 80
        if sk.panel_alpha:
            sk.panel(c, (22 + art_sz + 10, top + 4, 464, top + art_sz)); d = ImageDraw.Draw(c)
        if self.art is not None:
            c.paste(self.art.resize((art_sz, art_sz)), (22, top))
        else:
            sk.panel(c, (22, top, 22 + art_sz, top + art_sz), radius=14); d = ImageDraw.Draw(c)
            cx, cy = 22 + art_sz // 2, top + art_sz // 2
            for k in range(3):
                r = (10 if compact else 22) + k * (12 if compact else 18)
                a0 = (int(t * 90) // 10 * 10) % 360
                d.arc((cx - r, cy - r, cx + r, cy + r), a0, a0 + 200, fill=lerp_rgb(sk.accent, sk.bg, 0.3 + k * 0.2), width=4)
        tb = self.bgc() if not sk.panel_alpha else lerp_rgb(sk.bg, sk.card, 0.15)
        tx = 22 + art_sz + 24
        name = str(self.m.get("name") or self.m.get("id", "").replace("media_player.", "").replace("_", " "))
        self.box("title", str(self.m.get("title") or ("pornit" if self.m.get("state") == "playing" else "—")), speed=40).draw(c, (tx, top + 8, W - 22, top + 40), sk.mid, sk.fg, tb)
        self.box("artist", str(self.m.get("artist") or ""), speed=30).draw(c, (tx, top + 44, W - 22, top + 66), sk.small, sk.muted, tb)
        sk.text(d, (tx, top + 72), fit_text(d, name + ((" · " + str(self.m.get("app"))) if self.m.get("app") else ""), sk.tiny, W - 22 - tx), sk.tiny, sk.muted)
        dur = num(self.m.get("duration")) or 0
        by = top + art_sz - 4 if compact else 210
        if dur:
            bar(d, tx, by, W - tx - 22, 6, self.pos.value / dur, sk.accent, sk.track)
            if not compact:
                sk.text(d, (tx, by + 12), f"{int(self.pos.value)//60}:{int(self.pos.value)%60:02d}", sk.tiny, sk.muted)
                sk.text(d, (W - 22, by + 12), f"{int(dur)//60}:{int(dur)%60:02d}", sk.tiny, sk.muted, anchor="ra")
        if not compact:
            if self.m.get("state") == "playing":
                for i in range(5):
                    h = 8 + 18 * (0.5 + 0.5 * qsin(t * 5 + i * 1.1, 4))
                    d.rounded_rectangle((tx + i * 12, 290 - h, tx + i * 12 + 7, 290), radius=2, fill=sk.accent)
            else:
                d.rectangle((tx + 2, 268, tx + 8, 290), fill=sk.muted); d.rectangle((tx + 14, 268, tx + 20, 290), fill=sk.muted)
            return
        # the other players, one row each: state dot · name · what they play
        y = top + art_sz + 14
        rh = min(40, (H - 12 - y) // max(1, len(self.others)))
        arts = {}
        for i, o in enumerate(self.others):
            playing = o.get("state") == "playing"
            col = sk.ok if playing else sk.muted
            if playing:
                col = lerp_rgb(sk.ok, sk.bg, 0.3 * Pulse(1.6, i, steps=4).at(t))
            d.ellipse((26, y + rh // 2 - 9, 36, y + rh // 2 + 1), fill=col)
            oname = str(o.get("name") or o.get("id", "").replace("media_player.", "").replace("_", " "))
            sk.text(d, (46, y + 2), fit_text(d, oname, sk.tiny, 150), sk.tiny, sk.muted)
            what = str(o.get("title") or ("redă" if playing else "pauză"))
            if o.get("artist"):
                what += " — " + str(o.get("artist"))
            self.box(f"other{i}", what, speed=30).draw(c, (200, y - 2, W - 22, y + rh - 8), sk.small, sk.fg if playing else sk.muted, tb)
            y += rh


# ---------------------------------------------------------------- 8. lists
class ListsView(View):
    id, title = "lists", "Liste"

    def __init__(self, accent):
        super().__init__(accent)
        self.shop: list[str] = []; self.actions: list[dict] = []

    def update(self, st, dt):
        self.tick(dt)
        self.shop = (st.get("shopping") or [])[:6]
        self.actions = (st.get("actions") or [])[:5]

    def draw(self, c, t, progress):
        sk = self.sk
        self.header(c, "Cumpărături", f"{len(self.shop)}", progress)
        d = ImageDraw.Draw(c)
        if sk.panel_alpha:
            sk.panel(c, (16, 66, 250, 300)); sk.panel(c, (260, 66, 464, 300)); d = ImageDraw.Draw(c)
        tb = self.bgc() if not sk.panel_alpha else lerp_rgb(sk.bg, sk.card, 0.15)
        y = 74
        for i, s in enumerate(self.shop):
            p = Pulse(2.5, i * 0.6, steps=6).at(t)
            d.rounded_rectangle((22, y + 4, 34, y + 16), radius=3, outline=lerp_rgb(sk.muted, sk.accent, p), width=2)
            self.box(f"shop{i}", s).draw(c, (44, y - 4, 240, y + 22), sk.small, sk.fg, tb)
            y += 30
        if not self.shop:
            sk.text(d, (22, 80), "lista e goală", sk.small, sk.muted)
        sk.text(d, (268, 74), sk.label("ultimele acțiuni vmui"), sk.tiny, sk.muted)
        y = 100
        for i, a in enumerate(self.actions):
            hh = datetime.fromtimestamp((a.get("at") or 0) / 1000, TZ).strftime("%H:%M") if a.get("at") else ""
            sk.text(d, (268, y), hh, sk.tiny, sk.muted)
            self.box(f"act{i}", f"{a.get('action')} {a.get('target')}", speed=28).draw(c, (312, y - 2, W - 22, y + 16), sk.tiny, sk.fg, tb)
            y += 24


VIEWS: dict[str, type[View]] = {v.id: v for v in (ClockView, WeatherView, HomeView, AmbilightView, PcView, ActivityView, MediaView, ListsView)}

from views_extra import EXTRA_VIEWS  # noqa: E402  (registers the 11 additional views)

VIEWS.update(EXTRA_VIEWS)
