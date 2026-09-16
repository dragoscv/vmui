"""Third batch of Turzx views: Copilot agents, focus/time-tracking,
anniversaries and household energy. Same contract as views.py."""

from __future__ import annotations

import math
import time
from datetime import date, datetime

from PIL import Image, ImageDraw, ImageFont

from anim import Pulse, Tween, lerp_rgb
from views import TZ, H, W, View, bar, fit_text, gauge_arc, num, sparkline
from views_extra import MONTHS_SHORT


def ago(seconds: float) -> str:
    s = int(max(0, seconds))
    if s < 60:
        return f"{s}s"
    if s < 3600:
        return f"{s // 60} min"
    return f"{s // 3600} h {(s % 3600) // 60:02d}"


def hm(seconds: float) -> str:
    s = int(max(0, seconds))
    return f"{s // 3600}:{(s % 3600) // 60:02d}" if s >= 3600 else f"{s // 60} min"


# ---------------------------------------------------------------- 20. Copilot agents
class CopilotView(View):
    id, title = "copilot", "Agenți Copilot"
    wants_photo = False

    def __init__(self, accent):
        super().__init__(accent)
        self.active: list[dict] = []
        self.turns = 0
        self.sessions = 0
        self.now_ms = 0.0

    def visible(self, st):
        a = st.get("agents")
        return bool(a and (a.get("active") or a.get("turnsToday")))

    def update(self, st, dt):
        self.tick(dt)
        a = st.get("agents") or {}
        self.active = (a.get("active") or [])[:5]
        self.turns = int(a.get("turnsToday") or 0)
        self.sessions = int(a.get("sessionsToday") or 0)
        self.now_ms = st.get("now") or time.time() * 1000

    def draw(self, c, t, progress):
        sk = self.sk
        d = ImageDraw.Draw(c)
        self.header(c, self.title, f"{len(self.active)} active · {self.turns} turn-uri azi", progress)
        if not self.active:
            sk.text(d, (W // 2, 170), "niciun agent activ", sk.mid, sk.muted, anchor="mm")
            sk.text(d, (W // 2, 200), f"{self.sessions} sesiuni azi", sk.small, sk.muted, anchor="mm")
            return
        y = 62
        row_h = 48 if len(self.active) <= 4 else 40
        for i, s in enumerate(self.active):
            idle = (self.now_ms - (s.get("updatedAt") or 0)) / 1000
            live = idle < 90
            p = Pulse(1.4, i * 0.3).at(t) if live else 0.0
            col = sk.ok if live else sk.muted
            sk.panel(c, (22, y, W - 22, y + row_h - 6))
            d.ellipse((34, y + row_h // 2 - 9, 46, y + row_h // 2 + 3), fill=lerp_rgb(col, sk.bg, 0.6 * (1 - p)) if live else lerp_rgb(col, sk.bg, 0.5))
            repo = str(s.get("repo") or "?")
            sk.text(d, (56, y + 6), repo, sk.small, sk.fg)
            right = f"{s.get('turnsToday', 0)} t · {ago(idle)}"
            sk.text(d, (W - 34, y + 7), right, sk.tiny, col, anchor="ra")
            msg = s.get("lastUser") or ""
            if row_h >= 48 and msg:
                self.box(f"msg{i}", msg, speed=30).draw(c, (56, y + 26, W - 34, y + 40), sk.tiny, sk.muted, self.bgc())
            y += row_h
        if y < H - 24:
            sk.text(d, (22, H - 22), f"{self.sessions} sesiuni azi în total", sk.tiny, sk.muted)


# ---------------------------------------------------------------- 21. Focus
class FocusView(View):
    id, title = "focus", "Focus"

    ORDER = ["code", "terminal", "browser", "chat", "media", "other"]
    LABEL = {"code": "cod", "terminal": "terminal", "browser": "browser", "chat": "chat", "media": "media", "other": "altele"}

    def __init__(self, accent):
        super().__init__(accent)
        self.f: dict = {}
        self.tw: dict[str, Tween] = {}

    def update(self, st, dt):
        self.tick(dt)
        self.f = (st.get("pc") or {}).get("focus") or {}
        total = sum((self.f.get("buckets") or {}).values()) or 1
        for b in self.ORDER:
            tw = self.tw.setdefault(b, Tween(speed=3))
            tw.set((self.f.get("buckets") or {}).get(b, 0.0) / total)
            tw.step(dt)

    def draw(self, c, t, progress):
        sk = self.sk
        d = ImageDraw.Draw(c)
        idle_min = int(num(self.options.get("idleMin"), 5) or 5)
        idle = float(self.f.get("idle") or 0)
        away = idle > idle_min * 60
        buckets = self.f.get("buckets") or {}
        total = sum(buckets.values())
        self.header(c, self.title, f"azi {hm(total)} la PC", progress)
        # current window
        sk.panel(c, (22, 60, W - 22, 138))
        if away:
            sk.text(d, (36, 70), "plecat de la birou", sk.small, sk.muted)
            sk.text(d, (36, 96), f"idle {ago(idle)}", sk.mid, sk.fg)
        else:
            proc = str(self.f.get("proc") or "")
            b = self.LABEL.get(self._bucket_of(proc), "")
            sk.text(d, (36, 66), sk.label(b or "acum"), sk.tiny, sk.accent)
            self.box("title", str(self.f.get("title") or proc or "—"), speed=34).draw(c, (36, 66 + sk.tiny.size + 6, W - 150, 66 + sk.tiny.size + 6 + sk.mid.size + 6), sk.mid, sk.fg, self.bgc())
            since = time.time() - float(self.f.get("since") or time.time())
            sk.text(d, (W - 36, 92), ago(since), sk.mid, sk.accent, anchor="ra")
            sk.text(d, (W - 36, 118), "în această fereastră", sk.tiny, sk.muted, anchor="ra")
        # day split as a segmented bar + legend
        x0, x1, y = 22, W - 22, 160
        d.rounded_rectangle((x0, y, x1, y + 16), 8, fill=lerp_rgb(sk.fg, sk.bg, 0.9))
        x = x0
        cols = {"code": sk.accent, "terminal": lerp_rgb(sk.accent, sk.fg, 0.4), "browser": sk.ok, "chat": sk.warn, "media": lerp_rgb(sk.bad, sk.fg, 0.2), "other": sk.muted}
        for b in self.ORDER:
            w = int((x1 - x0) * self.tw[b].value)
            if w > 1:
                d.rectangle((x, y, x + w, y + 16), fill=cols[b])
                x += w
        ly = 190
        for i, b in enumerate([b for b in self.ORDER if buckets.get(b, 0) >= 60][:6]):
            cx = 22 + (i % 3) * 150
            cy = ly + (i // 3) * 40
            d.rectangle((cx, cy + 4, cx + 10, cy + 14), fill=cols[b])
            sk.text(d, (cx + 18, cy), self.LABEL[b], sk.tiny, sk.muted)
            sk.text(d, (cx + 18, cy + 14), hm(buckets.get(b, 0)), sk.small, sk.fg)
        if total < 60:
            sk.text(d, (W // 2, 230), "ziua abia începe", sk.small, sk.muted, anchor="mm")

    def _bucket_of(self, proc: str) -> str:
        p = proc.lower()
        for b, names in {
            "code": ("code", "code - insiders", "cursor", "devenv", "rider", "pycharm", "idea", "windsurf"),
            "browser": ("chrome", "msedge", "firefox", "brave", "arc", "opera", "vivaldi"),
            "terminal": ("windowsterminal", "pwsh", "powershell", "cmd", "wt", "alacritty"),
            "media": ("spotify", "vlc", "mpc-hc", "musicbee", "obs64", "mixxx", "rekordbox"),
            "chat": ("discord", "slack", "teams", "ms-teams", "telegram", "whatsapp", "signal", "zoom"),
        }.items():
            if p in names:
                return b
        return "other"


# ---------------------------------------------------------------- 22. Anniversaries
class AnniversariesView(View):
    id, title = "anniversaries", "Aniversări"

    def __init__(self, accent):
        super().__init__(accent)
        self.items: list[tuple[int, int, str, date]] = []  # (days_left, age_turning, name, next_date)

    def visible(self, st):
        return bool(self.items)

    def update(self, st, dt):
        self.tick(dt)
        today = datetime.now(TZ).date()
        out = []
        for line in self.options.get("people") or []:
            try:
                ds, _, name = str(line).strip().partition(" ")
                y, m, dd = (int(x) for x in ds.split("-"))
                born = date(y, m, dd)
            except Exception:
                continue
            try:
                nxt = born.replace(year=today.year)
            except ValueError:  # 29 Feb
                nxt = date(today.year, 3, 1)
            if nxt < today:
                nxt = nxt.replace(year=today.year + 1)
            out.append(((nxt - today).days, nxt.year - born.year, name.strip() or "—", nxt))
        out.sort()
        self.items = out[:5]

    def draw(self, c, t, progress):
        sk = self.sk
        d = ImageDraw.Draw(c)
        self.header(c, self.title, f"{len(self.items)} urmărite", progress)
        if not self.items:
            sk.text(d, (W // 2, 170), "adaugă persoane din /home", sk.small, sk.muted, anchor="mm")
            return
        first = self.items[0]
        days, age, name, nxt = first
        sk.panel(c, (22, 60, W - 22, 150))
        if days == 0:
            p = Pulse(1.2).at(t)
            sk.text(d, (36, 70), sk.label("astăzi!"), sk.tiny, lerp_rgb(sk.warn, sk.fg, p * 0.5))
            sk.text(d, (36, 90), fit_text(d, f"{name} împlinește {age}", sk.mid, W - 80), sk.mid, sk.fg)
            sk.text(d, (36, 122), "la mulți ani 🎉", sk.small, sk.accent)
        else:
            sk.text(d, (36, 70), sk.label("următoarea"), sk.tiny, sk.accent)
            sk.text(d, (36, 90), fit_text(d, name, sk.mid, 224), sk.mid, sk.fg)
            sk.text(d, (36, 122), fit_text(d, f"{nxt.day} {MONTHS_SHORT[nxt.month - 1]} · împlinește {age}", sk.small, 224), sk.small, sk.muted)
            ds = str(days)
            f_big = sk.big  # `huge` on the tall serif skins runs past the panel floor at 150
            while d.textlength(ds, font=f_big) > 130 and f_big.size > 30:
                f_big = ImageFont.truetype(f_big.path, f_big.size - 6)
            sk.text(d, (W - 36, 105), ds, f_big, sk.accent, anchor="rm")
            bb = d.textbbox((W - 36, 105), ds, font=f_big, anchor="rm")
            sk.text(d, (bb[0] - 8, 105), "zile" if days != 1 else "zi", sk.tiny, sk.muted, anchor="rm")
        y = 166
        for days, age, name, nxt in self.items[1:]:
            sk.text(d, (28, y), fit_text(d, name, sk.small, 240), sk.small, sk.fg)
            sk.text(d, (280, y), f"{nxt.day} {MONTHS_SHORT[nxt.month - 1]}", sk.small, sk.muted)
            sk.text(d, (W - 28, y), f"{days} z · {age}", sk.small, sk.muted, anchor="ra")
            y += 30
            if y > H - 30:
                break


# ---------------------------------------------------------------- 23. Energy
class EnergyView(View):
    id, title = "energy", "Energie"
    wants_photo = False

    def __init__(self, accent):
        super().__init__(accent)
        self.readings: list[dict] = []
        self.price = 1.3
        self.total_w = Tween(speed=3)
        self.hist: list[float] = []
        self.last_hist = 0.0
        self.batteries: list[dict] = []

    def visible(self, st):
        return bool((st.get("energy") or {}).get("readings") or st.get("batteries"))

    def update(self, st, dt):
        self.tick(dt)
        e = st.get("energy") or {}
        self.readings = (e.get("readings") or [])[:5]
        self.price = float(e.get("pricePerKwh") or 1.3)
        tw = sum(float(r.get("powerW") or 0) for r in self.readings)
        self.total_w.set(tw)
        self.total_w.step(dt)
        if time.perf_counter() - self.last_hist > 5:
            self.last_hist = time.perf_counter()
            self.hist = (self.hist + [tw])[-60:]
        self.batteries = (st.get("batteries") or [])[:6]

    def draw(self, c, t, progress):
        sk = self.sk
        d = ImageDraw.Draw(c)
        kwh = sum(float(r.get("kwhToday") or 0) for r in self.readings)
        self.header(c, self.title, f"azi {kwh:.2f} kWh · {kwh * self.price:.2f} lei", progress)
        # big now
        w = self.total_w.value
        big = f"{w:,.0f}".replace(",", " ")
        sk.text(d, (22, 58), big, sk.huge, sk.fg)
        bb = d.textbbox((22, 58), big, font=sk.huge)
        sk.text(d, (bb[2] + 8, bb[3] - sk.small.size - 4), "W", sk.small, sk.muted)
        sk.text(d, (22, bb[3] + 6), "acum, toate prizele", sk.tiny, sk.muted)
        if len(self.hist) > 2:
            sparkline(d, (22, bb[3] + 24, 200, min(H - 74, bb[3] + 54)), self.hist, sk.accent, width=2)
        # per-device bars
        x0, y = 216, 60
        mx = max([float(r.get("powerW") or 0) for r in self.readings] + [1.0])
        for r in self.readings:
            pw = float(r.get("powerW") or 0)
            sk.text(d, (x0, y), fit_text(d, str(r.get("name") or r.get("id")), sk.tiny, 150), sk.tiny, sk.muted)
            sk.text(d, (W - 22, y), f"{pw:.0f} W" if pw else f"{float(r.get('kwhToday') or 0):.2f} kWh", sk.tiny, sk.fg, anchor="ra")
            bar(d, x0, y + 14, W - 22 - x0, 5, pw / mx, sk.accent, lerp_rgb(sk.fg, sk.bg, 0.88))
            y += 28
        if not self.readings:
            sk.text(d, (x0, 70), "niciun senzor de putere", sk.small, sk.muted)
            sk.text(d, (x0, 92), "priză smart → Smart Life → HA", sk.tiny, sk.muted)
        # batteries strip
        by = H - 62
        d.line((22, by - 8, W - 22, by - 8), fill=lerp_rgb(sk.fg, sk.bg, 0.85))
        sk.text(d, (22, by - 4), sk.label("baterii"), sk.tiny, sk.muted)
        bx = 22
        for b in self.batteries:
            pct = float(b.get("pct") or 0)
            col = sk.bad if pct < 20 else sk.warn if pct < 40 else sk.ok
            nm = fit_text(d, str(b.get("name") or ""), sk.tiny, 62)
            # battery glyph
            d.rounded_rectangle((bx, by + 14, bx + 26, by + 26), 2, outline=sk.muted, width=1)
            d.rectangle((bx + 27, by + 17, bx + 29, by + 23), fill=sk.muted)
            d.rectangle((bx + 2, by + 16, bx + 2 + int(22 * pct / 100), by + 24), fill=col)
            sk.text(d, (bx + 34, by + 12), f"{pct:.0f}%{'⚡' if b.get('charging') else ''}", sk.tiny, sk.fg)
            sk.text(d, (bx, by + 30), nm, sk.tiny, sk.muted)
            bx += 76
            if bx > W - 80:
                break


# ---------------------------------------------------------------- 24. Health (Samsung Health → Health Connect → HA)
def _dash(v, fmt: str = "{:.0f}") -> str:
    return fmt.format(v) if isinstance(v, (int, float)) else "—"


def _stale(at_ms, now_ms: float) -> str:
    """'acum 3 min' / 'ieri' for a Health Connect timestamp, so a stale value
    (watch left on the desk) is not read as a live one."""
    if not at_ms:
        return ""
    s = (now_ms - float(at_ms)) / 1000
    if s < 90:
        return "acum"
    if s < 3600:
        return f"{int(s // 60)} min"
    if s < 86400:
        return f"{int(s // 3600)} h"
    return f"{int(s // 86400)} z"


class HealthView(View):
    id, title = "health", "Sănătate"
    wants_photo = False

    def __init__(self, accent):
        super().__init__(accent)
        self.h: dict = {}
        self.steps_tw = Tween(speed=2.5)
        self.beat = Pulse(period=1.0)

    def visible(self, st):
        return bool(st.get("health"))

    def update(self, st, dt):
        self.tick(dt)
        self.h = st.get("health") or {}
        self.steps_tw.set(float(self.h.get("steps") or 0))
        self.steps_tw.step(dt)
        hr = self.h.get("heartRate")
        if isinstance(hr, (int, float)) and hr > 0:
            self.beat.period = 60.0 / float(hr)

    def draw(self, c, t, progress):
        sk = self.sk
        d = ImageDraw.Draw(c)
        h = self.h
        now_ms = time.time() * 1000
        goal = float(h.get("stepsGoal") or 8000)
        steps = self.steps_tw.value
        kcal = h.get("totalKcal")
        right = f"{_dash(kcal)} kcal" if kcal is not None else ""
        self.header(c, self.title, right, progress)

        # ---- left: steps ring with the day's goal
        cx, cy, r = 86, 150, 58
        gauge_arc(d, cx, cy, r, min(1.0, steps / goal) if goal else 0.0, sk.accent, lerp_rgb(sk.fg, sk.bg, 0.86), width=10)
        big = f"{steps:,.0f}".replace(",", " ")
        sk.text(d, (cx, cy - 6), big, sk.mid, sk.fg, anchor="mm")
        sk.text(d, (cx, cy + 16), sk.label("pași"), sk.tiny, sk.muted, anchor="mm")
        sk.text(d, (cx, cy + r + 14), f"țintă {goal:,.0f}".replace(",", " "), sk.tiny, sk.muted, anchor="mm")
        km = h.get("distanceKm")
        fl = h.get("floors")
        sub = " · ".join(x for x in (f"{km:.1f} km" if isinstance(km, (int, float)) and km > 0 else "", f"{fl:.0f} etaje" if isinstance(fl, (int, float)) and fl > 0 else "") if x)
        if sub:
            sk.text(d, (cx, cy + r + 30), sub, sk.tiny, sk.muted, anchor="mm")

        # ---- middle: heart rate with a pulsing dot and a 24 h sparkline
        x0 = 178
        hr = h.get("heartRate")
        sk.text(d, (x0, 58), sk.label("puls"), sk.tiny, sk.muted)
        col = sk.ok if isinstance(hr, (int, float)) and hr < 100 else sk.warn if isinstance(hr, (int, float)) else sk.muted
        rr = 5 + int(3 * self.beat.at(t)) if isinstance(hr, (int, float)) else 4
        d.ellipse((x0 + 2, 84 - rr, x0 + 2 + 2 * rr, 84 + rr), fill=col)
        sk.text(d, (x0 + 22, 68), _dash(hr), sk.big, sk.fg)
        bb = d.textbbox((x0 + 22, 68), _dash(hr), font=sk.big)
        sk.text(d, (bb[2] + 6, bb[3] - sk.tiny.size - 3), "bpm", sk.tiny, sk.muted)
        age = _stale(h.get("heartRateAt"), now_ms)
        if age:
            sk.text(d, (bb[2] + 6, bb[3] - 2 * sk.tiny.size - 6), age, sk.tiny, sk.muted)
        hist = [float(p.get("v") or 0) for p in (h.get("hrHistory") or []) if isinstance(p, dict)]
        if len(hist) > 2:
            sparkline(d, (x0, bb[3] + 6, x0 + 160, bb[3] + 34), hist, col, width=2)
            sk.text(d, (x0, bb[3] + 36), f"24 h  {min(hist):.0f}–{max(hist):.0f}", sk.tiny, sk.muted)
        rest = h.get("restingHr")
        hrv = h.get("hrv")
        line = " · ".join(x for x in (f"repaus {rest:.0f}" if isinstance(rest, (int, float)) else "", f"HRV {hrv:.0f} ms" if isinstance(hrv, (int, float)) else "") if x)
        if line:
            sk.text(d, (x0, bb[3] + 52), line, sk.tiny, sk.muted)

        # ---- right column: sleep, SpO2, weight, blood pressure
        rx = 352
        y = 58
        slp = h.get("sleepMin")
        sk.text(d, (rx, y), sk.label("somn"), sk.tiny, sk.muted)
        sk.text(d, (rx, y + 14), hm(float(slp) * 60) if isinstance(slp, (int, float)) else "—", sk.mid, sk.fg)
        sg = float(h.get("sleepGoalMin") or 480)
        if isinstance(slp, (int, float)):
            bar(d, rx, y + 44, W - 22 - rx, 4, min(1.0, float(slp) / sg), sk.ok if slp >= sg * 0.9 else sk.warn, lerp_rgb(sk.fg, sk.bg, 0.88))
        y += 60
        spo2 = h.get("spo2")
        sk.text(d, (rx, y), sk.label("SpO₂"), sk.tiny, sk.muted)
        s2 = f"{spo2:.0f}%" if isinstance(spo2, (int, float)) else "—"
        sk.text(d, (rx, y + 14), s2, sk.mid, sk.bad if isinstance(spo2, (int, float)) and spo2 < 94 else sk.fg)
        rr_ = h.get("respiratoryRate")
        if isinstance(rr_, (int, float)):
            b2 = d.textbbox((rx, y + 14), s2, font=sk.mid)
            sk.text(d, (b2[2] + 6, b2[3] - sk.tiny.size - 2), fit_text(d, f"{rr_:.0f} resp", sk.tiny, W - 22 - b2[2] - 6), sk.tiny, sk.muted)
        y += 60
        wk = h.get("weightKg")
        sk.text(d, (rx, y), sk.label("greutate"), sk.tiny, sk.muted)
        wtxt = f"{wk:.1f}" if isinstance(wk, (int, float)) else "—"
        sk.text(d, (rx, y + 14), wtxt, sk.mid, sk.fg)
        bf = h.get("bodyFat")
        wa = _stale(h.get("weightAt"), now_ms)
        extra = " · ".join(x for x in ("kg" if isinstance(wk, (int, float)) else "", f"{bf:.0f}%" if isinstance(bf, (int, float)) else "", wa) if x)
        if extra:
            b3 = d.textbbox((rx, y + 14), wtxt, font=sk.mid)
            sk.text(d, (b3[2] + 6, b3[3] - sk.tiny.size - 2), fit_text(d, extra, sk.tiny, W - 22 - b3[2] - 6), sk.tiny, sk.muted)
        y += 60
        bp = h.get("bloodPressure")
        if isinstance(bp, dict) and y < H - 62:
            sk.text(d, (rx, y), sk.label("tensiune"), sk.tiny, sk.muted)
            sk.text(d, (rx, y + 14), f"{bp.get('sys')}/{bp.get('dia')}", sk.mid, sk.fg)

        # ---- footer
        act = h.get("activeKcal")
        vo2 = h.get("vo2max")
        imp = h.get("impedance")
        foot = " · ".join(x for x in (f"activ {act:.0f} kcal" if isinstance(act, (int, float)) else "", f"VO₂max {vo2:.0f}" if isinstance(vo2, (int, float)) else "", f"{imp:.0f} Ω" if isinstance(imp, (int, float)) else "", "Samsung Health · Health Connect") if x)
        sk.text(d, (22, H - 24), fit_text(d, foot, sk.tiny, W - 44), sk.tiny, sk.muted)


MORE_VIEWS = {v.id: v for v in (CopilotView, FocusView, AnniversariesView, EnergyView, HealthView)}
