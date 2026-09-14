"""The eight Turzx views. Each is a class with update(state, dt) and
draw(canvas, t) -> paints a 480x320 RGB frame. All visible motion is driven
by Tween/MorphDigit so values glide instead of jumping."""

from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from anim import MorphText, Pulse, Tween, ease_out_back, ease_out_cubic, lerp, lerp_rgb, qsin

W, H = 480, 320
TZ = ZoneInfo("Europe/Bucharest")
FONT_DIR = r"C:\Windows\Fonts"

BG = (14, 15, 22)
FG = (236, 238, 245)
MUTED = (128, 134, 155)
OK = (74, 222, 128)
WARN = (251, 191, 36)
BAD = (248, 113, 113)


def font(size: int, weight: str = "sb") -> ImageFont.FreeTypeFont:
    name = {"sb": "seguisb.ttf", "r": "segoeui.ttf", "l": "segoeuil.ttf", "b": "segoeuib.ttf", "mono": "consola.ttf"}[weight]
    return ImageFont.truetype(f"{FONT_DIR}\\{name}", size)


F_HUGE, F_BIG, F_MID, F_SMALL, F_TINY = font(118, "l"), font(48), font(26), font(19, "r"), font(15, "r")
F_MONO = font(18, "mono")

DAYS = ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"]
MONTHS = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"]


def hex_rgb(h: str) -> tuple[int, int, int]:
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
def header(d: ImageDraw.ImageDraw, title: str, right: str, accent: tuple[int, int, int], t: float) -> None:
    d.text((22, 14), title, font=F_MID, fill=FG)
    if right:
        d.text((W - 22, 20), right, font=F_SMALL, fill=MUTED, anchor="ra")
    # breathing accent underline (6 discrete widths)
    p = Pulse(3.2, steps=6).at(t)
    d.rounded_rectangle((22, 52, 22 + 46 + int(24 * p), 55), radius=2, fill=accent)


def gauge_arc(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, value01: float, color, track=(34, 36, 48), width=12) -> None:
    box = (cx - r, cy - r, cx + r, cy + r)
    d.arc(box, 135, 405, fill=track, width=width)
    if value01 > 0:
        d.arc(box, 135, 135 + int(270 * max(0.0, min(1.0, value01))), fill=color, width=width)


def bar(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, value01: float, color, track=(34, 36, 48)) -> None:
    d.rounded_rectangle((x, y, x + w, y + h), radius=h // 2, fill=track)
    fw = int(w * max(0.0, min(1.0, value01)))
    if fw > h:
        d.rounded_rectangle((x, y, x + fw, y + h), radius=h // 2, fill=color)


_GLOW_CACHE: dict[tuple, Image.Image] = {}


def glow(canvas: Image.Image, cx: int, cy: int, r: int, color, alpha: int = 90) -> None:
    """Soft radial glow. Inputs are quantised and the blurred sprite cached, so
    a slowly-changing glow costs no bandwidth until it visibly changes."""
    r = max(8, int(r) // 4 * 4)
    alpha = int(alpha) // 8 * 8
    color = tuple(int(c) // 8 * 8 for c in color)
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


def morph_text(d: ImageDraw.ImageDraw, x: int, y: int, mt: MorphText, f: ImageFont.FreeTypeFont, fill, advance: int) -> None:
    """Each slot: old glyph slides up & fades, new glyph slides in from below."""
    for i, s in enumerate(mt.slots):
        sx = x + i * advance
        if s.t >= 1.0:
            d.text((sx, y), s.char, font=f, fill=fill)
            continue
        e = ease_out_cubic(s.t)
        rise = int(28 * e)
        old_fill = lerp_rgb(fill, BG, e)
        new_fill = lerp_rgb(BG, fill, e)
        d.text((sx, y - rise), s.prev, font=f, fill=old_fill)
        d.text((sx, y + 28 - rise), s.char, font=f, fill=new_fill)


# ---------------------------------------------------------------- views
class View:
    id = "view"
    title = ""
    transition = "slide"

    def __init__(self, accent: tuple[int, int, int]) -> None:
        self.accent = accent
        self.t0 = time.perf_counter()

    def update(self, st: dict, dt: float) -> None: ...

    def draw(self, c: Image.Image, t: float) -> None: ...

    def enter(self) -> None:
        self.t0 = time.perf_counter()


class ClockView(View):
    id, title = "clock", "Ceas"

    def __init__(self, accent):
        super().__init__(accent)
        self.hhmm = MorphText(5)
        self.sec = MorphText(2)
        self.temp_in = Tween(speed=2.5)
        self.temp_out = Tween(speed=2.5)
        self.hum = Tween(speed=2.5)
        self.now = datetime.now(TZ)

    def update(self, st, dt):
        self.now = datetime.now(TZ)
        self.hhmm.set(self.now.strftime("%H:%M"))
        self.sec.set(self.now.strftime("%S"))
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

    def draw(self, c, t):
        d = ImageDraw.Draw(c)
        n = self.now
        d.text((22, 18), DAYS[n.weekday()], font=F_MID, fill=FG)
        d.text((22, 52), f"{n.day} {MONTHS[n.month-1]} {n.year}", font=F_SMALL, fill=MUTED)
        # big morphing time
        morph_text(d, 26, 84, self.hhmm, F_HUGE, FG, advance=76)
        # seconds + blinking colon feel: seconds fade with sub-second phase
        sub = n.microsecond / 1e6
        secfill = lerp_rgb(self.accent, MUTED, round((0.5 + 0.5 * math.cos(2 * math.pi * sub)) * 4) / 4)
        morph_text(d, 410, 130, self.sec, F_BIG, secfill, advance=28)
        # bottom row: inside / outside
        y = 262
        d.text((22, y), "înăuntru", font=F_TINY, fill=MUTED)
        d.text((22, y + 18), f"{self.temp_in.value:.1f}°C  {self.hum.value:.0f}%", font=F_MID, fill=FG)
        d.text((W - 22, y), "afară", font=F_TINY, fill=MUTED, anchor="ra")
        d.text((W - 22, y + 18), f"{self.temp_out.value:.0f}°C", font=F_MID, fill=FG, anchor="ra")
        # progress of the day as a thin bar
        frac = (n.hour * 3600 + n.minute * 60 + n.second) / 86400
        bar(d, 22, H - 8, W - 44, 4, frac, self.accent)


class WeatherView(View):
    id, title, transition = "weather", "Vremea", "fade"
    RO = {"clear-night": "senin", "sunny": "soare", "cloudy": "înnorat", "partlycloudy": "parțial noros", "fog": "ceață", "hail": "grindină",
          "lightning": "furtună", "lightning-rainy": "furtună cu ploaie", "pouring": "ploaie torențială", "rainy": "ploaie", "snowy": "ninsoare",
          "snowy-rainy": "lapoviță", "windy": "vânt", "windy-variant": "vânt", "exceptional": "extrem"}

    def __init__(self, accent):
        super().__init__(accent)
        self.temp = Tween(speed=2.0); self.hum = Tween(speed=2.0); self.wind = Tween(speed=2.0); self.pres = Tween(speed=2.0)
        self.cond = "unknown"; self.sun = None

    def update(self, st, dt):
        w = st.get("weather") or {}
        a = w.get("attributes") or {}
        self.cond = w.get("state") or "unknown"
        tc = celsius(a.get("temperature"), a.get("temperature_unit"))
        if tc is not None: self.temp.set(tc)
        if (h := num(a.get("humidity"))) is not None: self.hum.set(h)
        ws = num(a.get("wind_speed"))
        if ws is not None:
            u = a.get("wind_speed_unit")
            self.wind.set(ws * 1.609344 if u == "mph" else ws * 3.6 if u == "m/s" else ws)
        p = num(a.get("pressure"))
        if p is not None:
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
            glow(c, cx - 14, cy - 10, 56, col, 70)
            d = ImageDraw.Draw(c)
            d.ellipse((cx - 14 - r, cy - 10 - r, cx - 14 + r, cy - 10 + r), fill=col)
            if cond != "clear-night":
                for k in range(8):
                    ang = round(t * 0.6 * 16) / 16 + k * math.pi / 4  # ~10 fps ray rotation
                    x0, y0 = cx - 14 + math.cos(ang) * (r + 10), cy - 10 + math.sin(ang) * (r + 10)
                    x1, y1 = cx - 14 + math.cos(ang) * (r + 20), cy - 10 + math.sin(ang) * (r + 20)
                    d.line((x0, y0, x1, y1), fill=col, width=4)
        if cloudy:
            drift = qsin(t * 0.8, 6) * 6
            ox = cx + 8 + drift
            col = (226, 232, 240) if cond == "partlycloudy" else (148, 163, 184)
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

    def draw(self, c, t):
        d = ImageDraw.Draw(c)
        header(d, "Vremea", "Acasă", self.accent, t)
        self._icon(c, 110, 160, t)
        d = ImageDraw.Draw(c)
        d.text((236, 78), f"{self.temp.value:.0f}", font=F_HUGE, fill=FG)
        d.text((236 + d.textlength(f"{self.temp.value:.0f}", font=F_HUGE) + 6, 96), "°C", font=F_MID, fill=MUTED)
        d.text((236, 210), self.RO.get(self.cond, self.cond), font=F_MID, fill=self.accent)
        rows = [("umiditate", f"{self.hum.value:.0f}%"), ("vânt", f"{self.wind.value:.0f} km/h"), ("presiune", f"{self.pres.value:.0f} hPa")]
        for i, (k, v) in enumerate(rows):
            y = 252 + i * 22
            d.text((236, y), k, font=F_TINY, fill=MUTED)
            d.text((236 + 150, y), v, font=F_SMALL, fill=FG, anchor="ra")
        if self.sun:
            a = self.sun.get("attributes") or {}
            up = self.sun.get("state") == "above_horizon"
            nxt = a.get("next_setting" if up else "next_rising")
            if isinstance(nxt, str):
                try:
                    hh = datetime.fromisoformat(nxt.replace("Z", "+00:00")).astimezone(TZ).strftime("%H:%M")
                    d.text((W - 22, 252), ("apus " if up else "răsărit ") + hh, font=F_SMALL, fill=MUTED, anchor="ra")
                except ValueError:
                    pass


class HomeView(View):
    id, title = "home", "Acasă"

    def __init__(self, accent):
        super().__init__(accent)
        self.lights = Tween(speed=3); self.total = 1
        self.rows: list[tuple[str, str, tuple[int, int, int]]] = []
        self.ac = []

    def update(self, st, dt):
        h = st.get("home") or {}
        self.lights.set(h.get("lightsOn") or 0); self.lights.step(dt)
        self.total = max(1, h.get("lightsTotal") or 1)
        def s(x): return (x or {}).get("state")
        door = s(h.get("door")); pres = s(h.get("presence")); person = s(h.get("person"))
        self.rows = [
            ("Ușa", "DESCHISĂ" if door == "on" else "închisă" if door == "off" else "—", BAD if door == "on" else OK),
            ("Dormitor", "cineva" if pres == "on" else "gol" if pres == "off" else "—", self.accent if pres == "on" else MUTED),
            ("Dragoș", "acasă" if person == "home" else "plecat" if person == "not_home" else (person or "—"), OK if person == "home" else MUTED),
        ]
        self.ac = []
        for label, key in (("AC dormitor", "acBedroom"), ("AC living", "acLiving")):
            c = h.get(key)
            if not c: self.ac.append((label, "—", None, None)); continue
            a = c.get("attributes") or {}
            if c.get("state") == "off": self.ac.append((label, "oprit", None, None)); continue
            self.ac.append((label, c["state"], celsius(a.get("temperature"), a.get("temperature_unit")), celsius(a.get("current_temperature"), a.get("temperature_unit"))))

    def draw(self, c, t):
        d = ImageDraw.Draw(c)
        header(d, "Acasă", "", self.accent, t)
        # lights ring
        gauge_arc(d, 92, 170, 58, self.lights.value / self.total, WARN if self.lights.value > 0 else MUTED)
        d.text((92, 160), f"{self.lights.value:.0f}", font=F_BIG, fill=FG, anchor="mm")
        d.text((92, 196), f"din {self.total} lumini", font=F_TINY, fill=MUTED, anchor="mm")
        # status rows with animated dots
        y = 78
        for i, (k, v, col) in enumerate(self.rows):
            p = Pulse(2.0, i, steps=6).at(t)
            r = 5 + 2 * p if col in (BAD, OK, self.accent) else 5
            d.ellipse((200 - r, y + 12 - r, 200 + r, y + 12 + r), fill=col)
            d.text((216, y), k, font=F_TINY, fill=MUTED)
            d.text((216, y + 16), v, font=F_MID if k == "Ușa" else F_SMALL, fill=FG)
            y += 52
        # AC cards
        for i, (label, mode, target, cur) in enumerate(self.ac):
            x = 200 + i * 140
            d.rounded_rectangle((x, 238, x + 128, 306), radius=12, fill=(24, 26, 36))
            d.text((x + 12, 246), label, font=F_TINY, fill=MUTED)
            if target is None:
                d.text((x + 12, 266), mode, font=F_SMALL, fill=MUTED)
            else:
                d.text((x + 12, 262), f"{target:.0f}°C", font=F_MID, fill=(96, 165, 250) if mode == "cool" else (251, 146, 60))
                if cur is not None: d.text((x + 116, 284), f"acum {cur:.1f}°", font=F_TINY, fill=MUTED, anchor="ra")


class AmbilightView(View):
    id, title, transition = "ambilight", "Ambilight", "zoom"

    def __init__(self, accent):
        super().__init__(accent)
        self.col = [Tween(speed=5) for _ in range(3)]
        self.bri = Tween(speed=4); self.mode = "—"; self.wall = (255, 255, 255); self.wall_s = 0.0; self.bar_on = False

    def update(self, st, dt):
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

    def draw(self, c, t):
        rgb = tuple(int(tw.value) for tw in self.col)
        # live glow of the strip colour behind a "monitor"
        glow(c, 150, 150, 120, rgb, int(40 + 60 * (self.bri.value / 255)))
        # Tweens settle to exact targets, so once the strip colour is steady the glow is free.
        d = ImageDraw.Draw(c)
        header(d, "Ambilight", self.mode, self.accent, t)
        d.rounded_rectangle((60, 92, 240, 208), radius=8, fill=(8, 8, 12), outline=rgb, width=3)
        d.rounded_rectangle((136, 208, 164, 222), radius=3, fill=(40, 42, 52))
        d.rounded_rectangle((104, 222, 196, 228), radius=3, fill=(40, 42, 52))
        # wall swatch
        d.text((276, 84), "perete", font=F_TINY, fill=MUTED)
        d.rounded_rectangle((276, 102, 336, 134), radius=8, fill=self.wall)
        d.text((346, 108), f"compensare {int(self.wall_s*100)}%", font=F_SMALL, fill=FG)
        d.text((276, 150), "bandă MELK", font=F_TINY, fill=MUTED)
        d.rounded_rectangle((276, 168, 336, 200), radius=8, fill=rgb)
        d.text((346, 166), f"{rgb[0]},{rgb[1]},{rgb[2]}", font=F_MONO, fill=FG)
        d.text((346, 186), f"{self.bri.value/2.55:.0f}%", font=F_SMALL, fill=MUTED)
        d.text((276, 216), "bară birou", font=F_TINY, fill=MUTED)
        d.text((276, 234), "aprinsă" if self.bar_on else "stinsă", font=F_SMALL, fill=OK if self.bar_on else MUTED)
        # animated equalizer-ish strip along the bottom reflecting the colour
        for i in range(24):
            hgt = 6 + 14 * (0.5 + 0.5 * qsin(t * 3 + i * 0.5, 4)) * (round(self.bri.value / 255, 1) + 0.15)
            x = 22 + i * 18
            d.rounded_rectangle((x, 300 - hgt, x + 10, 300), radius=3, fill=lerp_rgb(rgb, BG, 0.25))


class PcView(View):
    id, title = "pc", "PC"

    def __init__(self, accent):
        super().__init__(accent)
        self.cpu = Tween(speed=4); self.ram = Tween(speed=3); self.gpu = Tween(speed=4); self.gtemp = Tween(speed=2); self.vram = Tween(speed=3)
        self.hist: list[float] = [0.0] * 60
        self.acc = 0.0

    def update(self, st, dt):
        pc = st.get("pc") or {}
        for tw, k in ((self.cpu, "cpu"), (self.ram, "ram"), (self.gpu, "gpu"), (self.gtemp, "gpuTemp"), (self.vram, "vram")):
            if (v := num(pc.get(k))) is not None: tw.set(v)
            tw.step(dt)
        self.acc += dt
        if self.acc >= 0.5:
            self.acc = 0
            self.hist = self.hist[1:] + [self.cpu.value]

    def draw(self, c, t):
        d = ImageDraw.Draw(c)
        header(d, "PC", "dragos-pc", self.accent, t)
        for i, (label, tw, col, suf) in enumerate((("CPU", self.cpu, self.accent, "%"), ("GPU", self.gpu, (168, 85, 247), "%"), ("RAM", self.ram, (34, 211, 238), "%"))):
            cx = 90 + i * 150
            v = tw.value
            gauge_arc(d, cx, 150, 54, v / 100, col if v < 85 else BAD)
            d.text((cx, 144), f"{v:.0f}", font=F_BIG, fill=FG, anchor="mm")
            d.text((cx, 176), suf, font=F_TINY, fill=MUTED, anchor="mm")
            d.text((cx, 214), label, font=F_SMALL, fill=MUTED, anchor="mm")
        # sparkline of CPU
        pts = []
        for i, v in enumerate(self.hist):
            pts.append((22 + i * (W - 44) / 59, 300 - v * 0.5))
        if len(pts) > 1:
            d.line(pts, fill=lerp_rgb(self.accent, BG, 0.2), width=2)
        d.text((22, 236), f"GPU {self.gtemp.value:.0f}°C · VRAM {self.vram.value:.0f}%", font=F_TINY, fill=MUTED)


class ActivityView(View):
    id, title, transition = "activity", "Activitate", "wipe"

    def __init__(self, accent):
        super().__init__(accent)
        self.items: list[dict] = []
        self.seen: dict[str, float] = {}

    def update(self, st, dt):
        self.items = (st.get("activity") or [])[:6]
        now = time.perf_counter()
        for it in self.items:
            self.seen.setdefault(f"{it.get('at')}|{it.get('text')}", now)

    def draw(self, c, t):
        d = ImageDraw.Draw(c)
        header(d, "Activitate", f"{len(self.items)} evenimente", self.accent, t)
        y = 74
        now = time.perf_counter()
        for it in self.items:
            key = f"{it.get('at')}|{it.get('text')}"
            age = now - self.seen.get(key, now)
            if age >= 0.6:
                e, alpha = 1.0, 1.0
            else:
                e = ease_out_back(age / 0.6)
                alpha = min(1.0, age / 0.4)
            x = int(22 + (1 - e) * 60)
            hh = datetime.fromtimestamp((it.get("at") or 0) / 1000, TZ).strftime("%H:%M")
            kind = it.get("kind") or ""
            col = {"assist": (168, 85, 247), "door": WARN, "light": (250, 204, 21)}.get(kind, self.accent)
            d.rounded_rectangle((x, y, x + 6, y + 34), radius=3, fill=lerp_rgb(BG, col, alpha))
            d.text((x + 16, y - 2), hh, font=F_TINY, fill=lerp_rgb(BG, MUTED, alpha))
            d.text((x + 16, y + 12), fit_text(d, str(it.get("text") or ""), F_SMALL, W - x - 40), font=F_SMALL, fill=lerp_rgb(BG, FG, alpha))
            y += 40
        if not self.items:
            d.text((W // 2, 180), "nimic recent", font=F_MID, fill=MUTED, anchor="mm")


class MediaView(View):
    id, title, transition = "media", "Redare", "fade"

    def __init__(self, accent):
        super().__init__(accent)
        self.m = None; self.pos = Tween(speed=8); self.art = None; self.art_url = None

    def update(self, st, dt):
        ms = st.get("media") or []
        self.m = next((x for x in ms if x.get("state") == "playing"), ms[0] if ms else None)
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
        self.art = st.get("_art")  # renderer injects a PIL image when it has fetched one

    def draw(self, c, t):
        d = ImageDraw.Draw(c)
        header(d, "Redare", (self.m or {}).get("app") or "", self.accent, t)
        if not self.m:
            d.text((W // 2, 180), "nimic în redare", font=F_MID, fill=MUTED, anchor="mm")
            return
        if self.art is not None:
            c.paste(self.art.resize((150, 150)), (22, 80))
        else:
            d.rounded_rectangle((22, 80, 172, 230), radius=14, fill=(24, 26, 36))
            # spinning disc
            for k in range(3):
                r = 22 + k * 18
                a0 = (int(t * 90) // 10 * 10) % 360
                d.arc((97 - r, 155 - r, 97 + r, 155 + r), a0, a0 + 200, fill=lerp_rgb(self.accent, BG, 0.3 + k * 0.2), width=4)
        d.text((196, 96), fit_text(d, str(self.m.get("title") or "—"), F_MID, W - 196 - 22), font=F_MID, fill=FG)
        d.text((196, 132), fit_text(d, str(self.m.get("artist") or ""), F_SMALL, W - 196 - 22), font=F_SMALL, fill=MUTED)
        d.text((196, 160), self.m.get("id", "").replace("media_player.", "").replace("_", " "), font=F_TINY, fill=MUTED)
        dur = num(self.m.get("duration")) or 0
        if dur:
            bar(d, 196, 210, W - 196 - 22, 6, self.pos.value / dur, self.accent)
            d.text((196, 222), f"{int(self.pos.value)//60}:{int(self.pos.value)%60:02d}", font=F_TINY, fill=MUTED)
            d.text((W - 22, 222), f"{int(dur)//60}:{int(dur)%60:02d}", font=F_TINY, fill=MUTED, anchor="ra")
        # playing bars
        if self.m.get("state") == "playing":
            for i in range(5):
                h = 8 + 18 * (0.5 + 0.5 * qsin(t * 5 + i * 1.1, 4))
                d.rounded_rectangle((196 + i * 12, 290 - h, 196 + i * 12 + 7, 290), radius=2, fill=self.accent)
        else:
            d.rectangle((198, 268, 204, 290), fill=MUTED); d.rectangle((210, 268, 216, 290), fill=MUTED)


class ListsView(View):
    id, title = "lists", "Liste"

    def __init__(self, accent):
        super().__init__(accent)
        self.shop: list[str] = []; self.actions: list[dict] = []

    def update(self, st, dt):
        self.shop = (st.get("shopping") or [])[:6]
        self.actions = (st.get("actions") or [])[:5]

    def draw(self, c, t):
        d = ImageDraw.Draw(c)
        header(d, "Cumpărături", f"{len(self.shop)}", self.accent, t)
        y = 74
        for i, s in enumerate(self.shop):
            p = Pulse(2.5, i * 0.6, steps=6).at(t)
            d.rounded_rectangle((22, y + 4, 34, y + 16), radius=3, outline=lerp_rgb(MUTED, self.accent, p), width=2)
            d.text((44, y - 2), fit_text(d, s, F_SMALL, 200), font=F_SMALL, fill=FG)
            y += 30
        if not self.shop:
            d.text((22, 80), "lista e goală", font=F_SMALL, fill=MUTED)
        d.text((268, 74), "ultimele acțiuni vmui", font=F_TINY, fill=MUTED)
        y = 96
        for a in self.actions:
            hh = datetime.fromtimestamp((a.get("at") or 0) / 1000, TZ).strftime("%H:%M") if a.get("at") else ""
            d.text((268, y), hh, font=F_TINY, fill=MUTED)
            d.text((312, y - 2), fit_text(d, f"{a.get('action')} {a.get('target')}", F_TINY, W - 312 - 22), font=F_TINY, fill=FG)
            y += 24


VIEWS = {v.id: v for v in (ClockView, WeatherView, HomeView, AmbilightView, PcView, ActivityView, MediaView, ListsView)}
