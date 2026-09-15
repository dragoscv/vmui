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


MORE_VIEWS = {v.id: v for v in (CopilotView, FocusView, AnniversariesView, EnergyView)}
