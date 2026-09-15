"""The additional Turzx views: money, photos, fleet, climate history,
calendar, pomodoro, network, countdowns, quote and the night ambient screen.

Same contract as views.py — `update(state, dt)` then `draw(canvas, t,
progress)`, everything through `self.sk` so each one honours its skin.
"""

from __future__ import annotations

import math
import re
import socket

from PIL import ImageFont
import subprocess
import threading
import time
from datetime import datetime, timedelta

import psutil
from PIL import Image, ImageDraw

from anim import Pulse, Tween, ease_out_cubic, lerp_rgb, qsin
from views import TZ, H, W, View, bar, fit_text, gauge_arc, glow, num, sparkline

MONTHS_SHORT = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "noi", "dec"]


def human_dt(ms: float) -> str:
    d = datetime.fromtimestamp(ms / 1000, TZ)
    now = datetime.now(TZ)
    if d.date() == now.date():
        return d.strftime("azi %H:%M")
    if d.date() == (now + timedelta(days=1)).date():
        return d.strftime("mâine %H:%M")
    return f"{d.day} {MONTHS_SHORT[d.month - 1]} {d.strftime('%H:%M')}"


# ---------------------------------------------------------------- 9. BNR FX
class FxView(View):
    id, title = "fx", "Curs BNR"

    def __init__(self, accent):
        super().__init__(accent)
        self.rates: list[dict] = []
        self.date = ""
        self.tw: dict[str, Tween] = {}

    def update(self, st, dt):
        self.tick(dt)
        fx = st.get("fx") or {}
        self.date = fx.get("date") or ""
        self.rates = (fx.get("rates") or [])[:4]
        for r in self.rates:
            tw = self.tw.setdefault(r["code"], Tween(speed=2.5))
            tw.set(num(r.get("rate")) or 0)
            tw.step(dt)

    def draw(self, c, t, progress):
        sk = self.sk
        self.header(c, "Curs BNR", self.date, progress)
        d = ImageDraw.Draw(c)
        if not self.rates:
            sk.text(d, (W // 2, 180), "fără date", sk.mid, sk.muted, anchor="mm")
            return
        if sk.id == "editorial" and self.rates:
            r = self.rates[0]
            v = self.tw[r["code"]].value
            prev = num(r.get("prev"))
            up = prev is not None and v >= prev
            big = f"{v:.4f}"
            f_big = sk.huge
            while d.textlength(big, font=f_big) > 330 and f_big.size > 40:
                f_big = ImageFont.truetype(f_big.path, f_big.size - 6)  # editorial serif is wide; keep the right column clear
            sk.text(d, (22, 58), big, f_big, sk.fg)
            sk.text(d, (22, 208), f"1 {r['code']} = RON", sk.mid, sk.accent)
            if prev:
                delta = (v - prev) / prev * 100
                sk.text(d, (22, 244), f"{'▲' if up else '▼'} {abs(delta):.2f}% față de ieri", sk.small, sk.ok if up else sk.bad)
            sparkline(d, (22, 268, W - 22, 308), r.get("history") or [], sk.accent)
            for i, o in enumerate(self.rates[1:4]):
                x = 300 + 0
                sk.text(d, (W - 22, 62 + i * 34), f"{o['code']} {num(o.get('rate')) or 0:.4f}", sk.small, sk.muted, anchor="ra")
            return
        n = len(self.rates)
        cw = (W - 44) // max(1, n)
        for i, r in enumerate(self.rates):
            x = 22 + i * cw
            v = self.tw[r["code"]].value
            prev = num(r.get("prev"))
            up = prev is not None and v >= prev
            col = sk.ok if up else sk.bad
            sk.panel(c, (x, 72, x + cw - 12, 288))
            d = ImageDraw.Draw(c)
            sk.text(d, (x + 14, 84), sk.label(r["code"]), sk.small, sk.muted)
            sk.text(d, (x + 14, 108), f"{v:.4f}", sk.mid, sk.fg)
            if prev:
                delta = (v - prev) / prev * 100
                sk.text(d, (x + 14, 140), f"{'▲' if up else '▼'} {abs(delta):.2f}%", sk.tiny, col)
            sparkline(d, (x + 14, 200, x + cw - 26, 270), r.get("history") or [], col, fill_to=lerp_rgb(col, sk.bg, 0.82))
        foot = "RON per unitate · fixing BNR, publicat la 13:00"
        wa = str(self.options.get("watchAmount") or "").strip()
        if wa:
            amt, _, code = wa.partition(" ")
            r = next((x for x in self.rates if x["code"] == code.upper()), None)
            try:
                if r:
                    foot = f"{float(amt.replace(',', '.')):,.0f} {code.upper()} = {float(amt.replace(',', '.')) * self.tw[r['code']].value:,.0f} lei"
            except ValueError:
                pass
        sk.text(d, (22, 298), fit_text(d, sk.label(foot), sk.tiny, W - 44), sk.tiny, sk.muted)


# ---------------------------------------------------------------- 10. crypto
class CryptoView(View):
    id, title = "crypto", "Crypto"

    def __init__(self, accent):
        super().__init__(accent)
        self.coins: list[dict] = []
        self.tw: dict[str, Tween] = {}

    def update(self, st, dt):
        self.tick(dt)
        self.coins = (st.get("crypto") or [])[:4]
        for co in self.coins:
            tw = self.tw.setdefault(co["id"], Tween(speed=3))
            tw.set(num(co.get("price")) or 0)
            tw.step(dt)

    def draw(self, c, t, progress):
        sk = self.sk
        vs = str(self.options.get("vs") or "usd").upper()
        self.header(c, "Crypto", vs, progress)
        d = ImageDraw.Draw(c)
        if not self.coins:
            sk.text(d, (W // 2, 180), "fără date", sk.mid, sk.muted, anchor="mm")
            return
        rows = self.coins
        # portfolio: "id qty" lines from options → total value and today's move, one line under the header
        hold: dict[str, float] = {}
        for line in self.options.get("holdings") or []:
            cid, _, qty = str(line).strip().partition(" ")
            try:
                hold[cid.lower()] = float(qty.replace(",", "."))
            except ValueError:
                pass
        top = 76
        if hold:
            total = sum(self.tw[co["id"]].value * hold.get(co["id"], 0) for co in rows)
            delta = sum(self.tw[co["id"]].value * hold.get(co["id"], 0) * (num(co.get("change24h")) or 0) / 100 for co in rows)
            col = sk.ok if delta >= 0 else sk.bad
            sk.text(d, (26, 58), sk.label("portofoliu"), sk.tiny, sk.muted)
            sk.text(d, (W - 26, 56), f"{total:,.0f} {vs}  {'▲' if delta >= 0 else '▼'} {abs(delta):,.0f}", sk.small, col, anchor="ra")
            top = 82
        rh = min(56, (H - top - 14) // max(1, len(rows)))
        y = top
        for i, co in enumerate(rows):
            v = self.tw[co["id"]].value
            ch = num(co.get("change24h")) or 0
            col = sk.ok if ch >= 0 else sk.bad
            if sk.panel_alpha or sk.id == "neon":
                sk.panel(c, (16, y - 4, W - 16, y + rh - 12), radius=10)
                d = ImageDraw.Draw(c)
            if sk.glow:
                glow(c, 40, y + rh // 2 - 8, 28, col, 48)
                d = ImageDraw.Draw(c)
            sk.text(d, (26, y), sk.label(str(co.get("symbol") or "")), sk.mid, sk.fg)
            price = f"{v:,.0f}" if v >= 100 else f"{v:,.4f}"
            sk.text(d, (176, y + 2), price, sk.mid, sk.fg)
            pw = d.textlength(price, font=sk.mid)
            if 176 + pw + 5 + d.textlength(vs, font=sk.tiny) < 296:  # only when it clears the change column
                sk.text(d, (176 + pw + 5, y + 8), vs, sk.tiny, sk.muted)
            sk.text(d, (300, y + 6), f"{'▲' if ch >= 0 else '▼'} {abs(ch):.2f}%", sk.small, col)
            sparkline(d, (376, y, W - 26, y + rh - 20), co.get("sparkline") or [], col)
            y += rh


# ---------------------------------------------------------------- 11. photo
class PhotoView(View):
    id, title = "photo", "Foto"
    transition = "curtain"

    def __init__(self, accent):
        super().__init__(accent)
        self.meta: dict = {}

    def update(self, st, dt):
        self.tick(dt)
        self.meta = st.get("_bgmeta") or {}

    def draw(self, c, t, progress):
        """The renderer already painted the photo; this view only captions it."""
        sk = self.sk
        d = ImageDraw.Draw(c)
        if not self.options.get("caption", True):
            d.rounded_rectangle((22, H - 12, 22 + int(120 * progress), H - 9), radius=2, fill=sk.accent)
            return
        title = str(self.meta.get("title") or "")
        credit = str(self.meta.get("credit") or "")
        if not title and not credit:
            sk.text(d, (W // 2, H // 2), "fără imagine încă", sk.mid, sk.muted, anchor="mm")
            return
        # a readable strip along the bottom regardless of the photo underneath
        strip = Image.new("RGBA", (W, 86), (0, 0, 0, 0))
        sd = ImageDraw.Draw(strip)
        for i in range(86):
            sd.line((0, i, W, i), fill=(0, 0, 0, int(150 * (i / 86) ** 0.7)))
        c.paste(strip, (0, H - 86), strip)
        d = ImageDraw.Draw(c)
        self.box("title", title, speed=30).draw(c, (22, H - 76, W - 22, H - 44), sk.mid, (255, 255, 255), (12, 12, 14))
        self.box("credit", credit, speed=24).draw(c, (22, H - 42, W - 22, H - 20), sk.small, (198, 202, 214), (10, 10, 12))
        d.rounded_rectangle((22, H - 12, 22 + int(120 * progress), H - 9), radius=2, fill=sk.accent)


# ---------------------------------------------------------------- 12. fleet
class FleetView(View):
    id, title = "fleet", "Mașini virtuale"

    STATE_RO = {"running": "pornit", "stopped": "oprit", "pending": "pornește", "stopping": "se oprește", "terminated": "șters", "unknown": "—"}

    def __init__(self, accent):
        super().__init__(accent)
        self.vms: list[dict] = []

    def update(self, st, dt):
        self.tick(dt)
        self.vms = (st.get("fleet") or [])[:7]

    def dwell_scale(self, st):
        return 0.6 if not any(v.get("state") == "running" for v in st.get("fleet") or []) else 1.0

    def draw(self, c, t, progress):
        sk = self.sk
        running = sum(1 for v in self.vms if v.get("state") == "running")
        self.header(c, "Mașini virtuale", f"{running}/{len(self.vms)} pornite", progress)
        d = ImageDraw.Draw(c)
        if not self.vms:
            sk.text(d, (W // 2, 180), "nicio mașină sincronizată", sk.mid, sk.muted, anchor="mm")
            return
        tb = sk.bg if not sk.panel_alpha else lerp_rgb(sk.bg, sk.card, 0.15)
        y = 74
        rh = min(34, (H - 92) // len(self.vms))
        for i, v in enumerate(self.vms):
            state = v.get("state") or "unknown"
            col = sk.ok if state == "running" else sk.muted if state in ("stopped", "terminated") else sk.warn
            if state in ("pending", "stopping"):
                col = lerp_rgb(sk.warn, sk.bg, 0.5 + 0.5 * Pulse(1.2, i, steps=4).at(t) * 0.6)
            d.ellipse((24, y + rh // 2 - 9, 36, y + rh // 2 + 3), fill=col)
            self.box(f"vm{i}", str(v.get("name") or ""), speed=26).draw(c, (46, y, 250, y + rh - 6), sk.small, sk.fg, tb)
            sk.text(d, (262, y + 2), sk.label(str(v.get("provider") or "")), sk.tiny, sk.muted)
            # state on the first line, size on a second line under the name column
            # — the row is 34 px, two tiny lines fit and nothing shares an x-range
            sk.text(d, (W - 24, y + 2), self.STATE_RO.get(state, state), sk.tiny, col, anchor="ra")
            ty = str(v.get("type") or "")
            m = re.fullmatch(r"(\d+)c-(\d+)g", ty)
            sk.text(d, (262, y + 2 + sk.tiny.size + 2), f"{m[1]} vCPU · {m[2]} GB" if m else ty, sk.tiny, lerp_rgb(sk.muted, sk.bg, 0.3))
            y += rh


# ---------------------------------------------------------------- 13. climate history
class ClimateView(View):
    id, title = "climate", "Climat 24 h"
    wants_photo = False

    def __init__(self, accent):
        super().__init__(accent)
        self.temp: list[dict] = []
        self.hum: list[dict] = []

    def update(self, st, dt):
        self.tick(dt)
        cl = st.get("climate") or {}
        self.temp = cl.get("temp") or []
        self.hum = cl.get("hum") or []

    def draw(self, c, t, progress):
        sk = self.sk
        tv = [p["v"] for p in self.temp]
        hv = [p["v"] for p in self.hum]
        right = f"{tv[-1]:.1f}°C · {hv[-1]:.0f}%" if tv and hv else ""
        self.header(c, "Climat 24 h", right, progress)
        d = ImageDraw.Draw(c)
        if len(tv) < 2:
            sk.text(d, (W // 2, 180), "nu am istoric încă", sk.mid, sk.muted, anchor="mm")
            return
        tcol = (251, 146, 60)
        hcol = (56, 189, 248)
        box_t = (40, 84, W - 24, 190)
        box_h = (40, 210, W - 24, 286)
        for box, vals, col, unit in ((box_t, tv, tcol, "°C"), (box_h, hv, hcol, "%")):
            lo, hi = min(vals), max(vals)
            d.line((box[0], box[3], box[2], box[3]), fill=sk.track)
            d.line((box[0], box[1], box[2], box[1]), fill=sk.track)
            sparkline(d, box, vals, col, width=2, fill_to=lerp_rgb(col, sk.bg, 0.85))
            sk.text(d, (34, box[1] - 4), f"{hi:.0f}{unit}", sk.tiny, sk.muted, anchor="ra")
            sk.text(d, (34, box[3] - 12), f"{lo:.0f}{unit}", sk.tiny, sk.muted, anchor="ra")
            # a dot that breathes on the latest sample
            r = 3 + Pulse(2.4, steps=4).at(t)
            d.ellipse((box[2] - r, box[3] - (vals[-1] - lo) / ((hi - lo) or 1) * (box[3] - box[1]) - r, box[2] + r, box[3] - (vals[-1] - lo) / ((hi - lo) or 1) * (box[3] - box[1]) + r), fill=col)
        dT, dH = tv[-1] - tv[0], hv[-1] - hv[0]
        lt = sk.label(f"temp {dT:+.1f}° / 24 h")
        sk.text(d, (40, 292), lt, sk.tiny, tcol)
        sk.text(d, (40 + d.textlength(lt, font=sk.tiny) + 18, 292), sk.label(f"umid {dH:+.0f}% / 24 h"), sk.tiny, hcol)
        # midnight tick, so the curve has a time anchor
        pts = self.temp
        if pts:
            t0, t1 = pts[0]["t"], pts[-1]["t"]
            mid = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000
            if t0 < mid < t1 and t1 > t0:
                xm = int(box_t[0] + (mid - t0) / (t1 - t0) * (box_t[2] - box_t[0]))
                for box in (box_t, box_h):
                    d.line((xm, box[1], xm, box[3]), fill=lerp_rgb(sk.muted, sk.bg, 0.5))
                sk.text(d, (xm, box_t[3] + 2), "00:00", sk.tiny, sk.muted, anchor="ma")
        first = self.temp[0]["t"] if self.temp else 0
        if first:
            sk.text(d, (W - 24, 292), datetime.fromtimestamp(first / 1000, TZ).strftime("din %H:%M"), sk.tiny, sk.muted, anchor="ra")


# ---------------------------------------------------------------- 14. calendar
class CalendarView(View):
    id, title = "calendar", "Calendar"

    def __init__(self, accent):
        super().__init__(accent)
        self.events: list[dict] = []

    def update(self, st, dt):
        self.tick(dt)
        self.events = (st.get("calendar") or [])[:5]

    def draw(self, c, t, progress):
        sk = self.sk
        self.header(c, "Calendar", f"{len(self.events)} evenimente", progress)
        d = ImageDraw.Draw(c)
        if not self.events:
            sk.text(d, (W // 2, 180), "nimic programat", sk.mid, sk.muted, anchor="mm")
            return
        tb = sk.bg if not sk.panel_alpha else lerp_rgb(sk.bg, sk.card, 0.15)
        nxt = self.events[0]
        left = max(0, (nxt.get("start") or 0) / 1000 - time.time())
        hh, mm = int(left // 3600), int(left % 3600 // 60)
        sk.panel(c, (16, 68, W - 16, 158))
        d = ImageDraw.Draw(c)
        self.box("next", str(nxt.get("summary") or ""), speed=34).draw(c, (28, 78, W - 150, 112), sk.mid, sk.fg, tb)
        sk.text(d, (28, 118), human_dt(nxt.get("start") or 0) + (f" · {nxt.get('location')}" if nxt.get("location") else ""), sk.small, sk.muted)
        cd = f"{hh}h {mm:02d}m" if hh else f"{mm} min"
        sk.text(d, (W - 32, 84), cd, sk.big, sk.accent, anchor="ra")
        sk.text(d, (W - 32, 132), sk.label("până începe"), sk.tiny, sk.muted, anchor="ra")
        y = 176
        for i, e in enumerate(self.events[1:5]):
            d.ellipse((26, y + 8, 34, y + 16), fill=sk.accent if i == 0 else sk.muted)
            self.box(f"ev{i}", str(e.get("summary") or ""), speed=26).draw(c, (46, y, 320, y + 24), sk.small, sk.fg, tb)
            sk.text(d, (W - 24, y + 4), human_dt(e.get("start") or 0), sk.tiny, sk.muted, anchor="ra")
            y += 32


# ---------------------------------------------------------------- 15. pomodoro
class PomodoroView(View):
    id, title = "pomodoro", "Pomodoro"

    def __init__(self, accent):
        super().__init__(accent)
        self.p: dict = {}

    def visible(self, st):
        return (st.get("pomodoro") or {}).get("phase", "idle") != "idle"

    def update(self, st, dt):
        self.tick(dt)
        self.p = st.get("pomodoro") or {}

    def draw(self, c, t, progress):
        sk = self.sk
        phase = self.p.get("phase", "idle")
        ends = (self.p.get("endsAt") or 0) / 1000
        start = (self.p.get("startedAt") or 0) / 1000
        left = max(0.0, ends - time.time())
        total = max(1.0, ends - start)
        frac = left / total
        col = sk.accent if phase == "work" else sk.ok
        self.header(c, "Pomodoro", f"runda {self.p.get('round') or 1}", progress)
        d = ImageDraw.Draw(c)
        if sk.glow:
            glow(c, 240, 180, 96, col, int(40 + 40 * Pulse(4.0, steps=4).at(t)))
            d = ImageDraw.Draw(c)
        gauge_arc(d, 240, 180, 86, frac, col, sk.track, width=16)
        mm, ss = int(left // 60), int(left % 60)
        sk.text(d, (240, 168), f"{mm}:{ss:02d}", sk.big, sk.fg, anchor="mm")
        sk.text(d, (240, 226), sk.label("lucru" if phase == "work" else "pauză"), sk.small, col, anchor="mm")
        if left <= 0:
            sk.text(d, (240, 286), sk.label("gata!"), sk.mid, sk.warn, anchor="mm")


# ---------------------------------------------------------------- 16. network
class NetworkView(View):
    id, title = "network", "Rețea"
    wants_photo = False

    def __init__(self, accent):
        super().__init__(accent)
        self.ping = Tween(speed=3); self.up = Tween(speed=4); self.down = Tween(speed=4)
        self.hist: list[float] = [0.0] * 60
        self.last_io = psutil.net_io_counters()
        self.last_t = time.perf_counter()
        self.ping_ms: float | None = None
        self.peers = 0
        self._bg_started = 0.0

    def _probe(self, host: str) -> None:
        try:
            out = subprocess.run(["ping", "-n", "1", "-w", "1500", host], capture_output=True, text=True, creationflags=0x08000000).stdout
            ms = None
            for tok in out.replace("=", " ").replace("<", " ").split():
                if tok.endswith("ms"):
                    ms = num(tok[:-2])
                    break
            self.ping_ms = ms
        except Exception:
            self.ping_ms = None
        try:
            ts = subprocess.run(["tailscale", "status", "--json"], capture_output=True, text=True, timeout=8, creationflags=0x08000000).stdout
            self.peers = ts.count('"Online": true') + ts.count('"Online":true')
        except Exception:
            pass

    def update(self, st, dt):
        self.tick(dt)
        now = time.perf_counter()
        io = psutil.net_io_counters()
        span = max(1e-3, now - self.last_t)
        self.down.set((io.bytes_recv - self.last_io.bytes_recv) / span / 1024)
        self.up.set((io.bytes_sent - self.last_io.bytes_sent) / span / 1024)
        self.last_io, self.last_t = io, now
        self.down.step(dt); self.up.step(dt); self.ping.step(dt)
        self.hist = self.hist[1:] + [self.down.value]
        if now - self._bg_started > 10:
            self._bg_started = now
            threading.Thread(target=self._probe, args=(str(self.options.get("pingHost") or "1.1.1.1"),), daemon=True).start()
        if self.ping_ms is not None:
            self.ping.set(self.ping_ms)

    def draw(self, c, t, progress):
        sk = self.sk
        self.header(c, "Rețea", socket.gethostname(), progress)
        d = ImageDraw.Draw(c)
        cards = [
            ("ping", f"{self.ping.value:.0f}" if self.ping_ms is not None else "—", "ms", sk.ok if self.ping.value < 40 else sk.warn if self.ping.value < 120 else sk.bad),
            ("download", f"{self.down.value:,.0f}", "KB/s", sk.accent),
            ("upload", f"{self.up.value:,.0f}", "KB/s", (168, 85, 247) if sk.id != "terminal" else sk.accent),
            ("tailscale", str(self.peers or "—"), "online", sk.ok if self.peers else sk.muted),
        ]
        for i, (label, v, unit, col) in enumerate(cards):
            x = 22 + (i % 2) * 230
            y = 76 + (i // 2) * 110
            sk.panel(c, (x, y, x + 206, y + 92))
            d = ImageDraw.Draw(c)
            sk.text(d, (x + 14, y + 10), sk.label(label), sk.tiny, sk.muted)
            sk.text(d, (x + 14, y + 32), v, sk.big, col)
            sk.text(d, (x + 190, y + 66), unit, sk.tiny, sk.muted, anchor="ra")
        sparkline(d, (22, 296, W - 22, 314), self.hist, lerp_rgb(sk.accent, sk.bg, 0.25))
        peak = max(self.hist) if self.hist else 0
        if peak > 0:
            sk.text(d, (W - 22, 282), f"vârf {peak:,.0f} KB/s", sk.tiny, sk.muted, anchor="ra")


# ---------------------------------------------------------------- 17. countdown
class CountdownView(View):
    id, title = "countdown", "Countdown"

    def __init__(self, accent):
        super().__init__(accent)
        self.items: list[tuple[str, float]] = []

    def update(self, st, dt):
        self.tick(dt)
        raw = self.options.get("events")
        items: list[tuple[str, float]] = []
        for line in raw if isinstance(raw, list) else []:
            s = str(line).strip()
            if len(s) < 10:
                continue
            try:
                when = datetime.fromisoformat(s[:10]).replace(tzinfo=TZ)
            except ValueError:
                continue
            items.append((s[10:].strip() or s[:10], when.timestamp()))
        self.items = sorted(items, key=lambda x: x[1])[:5]

    def draw(self, c, t, progress):
        sk = self.sk
        self.header(c, "Countdown", "", progress)
        d = ImageDraw.Draw(c)
        if not self.items:
            sk.text(d, (W // 2, 170), "adaugă evenimente în /home", sk.mid, sk.muted, anchor="mm")
            return
        name, ts = self.items[0]
        left = ts - time.time()
        days = left / 86400
        tb = sk.bg if not sk.panel_alpha else lerp_rgb(sk.bg, sk.card, 0.15)
        if 0 <= left < 86400:
            big, unit = f"{int(left // 3600)}", f"ore · {int(left % 3600 // 60):02d} min"
        elif -86400 < left < 0:
            big, unit = "azi", ""
        else:
            big, unit = f"{abs(days):.0f}", "zile" if days >= 0 else "zile în urmă"
        sk.text(d, (22, 62), big, sk.huge, sk.fg if days >= 0 else sk.muted)
        wide = d.textlength(big, font=sk.huge)
        if unit:
            sk.text(d, (22 + wide + 10, 118), sk.label(unit), sk.mid, sk.accent)
        self.box("main", name, speed=32).draw(c, (22, 196, W - 22, 232), sk.mid, sk.fg, tb)
        y = 246
        for i, (n2, ts2) in enumerate(self.items[1:4]):
            dd = (ts2 - time.time()) / 86400
            sk.text(d, (22, y), f"{dd:,.0f} z", sk.small, sk.accent)
            self.box(f"cd{i}", n2, speed=24).draw(c, (96, y - 2, W - 22, y + 20), sk.small, sk.muted, tb)
            y += 24


# ---------------------------------------------------------------- 18. quote
class QuoteView(View):
    id, title = "quote", "Citat"
    transition = "curtain"

    def __init__(self, accent):
        super().__init__(accent)
        self.q: dict = {}
        self.reveal = 0.0

    def enter(self):
        super().enter()
        self.reveal = 0.0

    def update(self, st, dt):
        self.tick(dt)
        self.q = st.get("quote") or {}
        self.reveal = min(1.0, self.reveal + dt / 1.2)

    def draw(self, c, t, progress):
        sk = self.sk
        d = ImageDraw.Draw(c)
        text = str(self.q.get("text") or "")
        author = str(self.q.get("author") or "")
        if not text:
            sk.text(d, (W // 2, 170), "…", sk.huge, sk.muted, anchor="mm")
            return
        if sk.panel_alpha:
            sk.panel(c, (24, 60, W - 24, 260)); d = ImageDraw.Draw(c)
        # word-wrap by hand so nothing overflows the plate
        words = text.split()
        lines: list[str] = []
        cur = ""
        maxw = W - 96
        f = sk.mid if len(text) > 110 else sk.big
        for w in words:
            probe = (cur + " " + w).strip()
            if d.textlength(probe, font=f) > maxw and cur:
                lines.append(cur)
                cur = w
            else:
                cur = probe
        if cur:
            lines.append(cur)
        lines = lines[:5]
        sk.text(d, (34, 72), "“", sk.huge, lerp_rgb(sk.accent, sk.bg, 0.55))
        y = 112
        shown = int(len(lines) * ease_out_cubic(self.reveal)) + 1
        for i, ln in enumerate(lines[:shown]):
            sk.text(d, (52, y), ln, f, sk.fg)
            y += f.size + 10
        if author:
            sk.text(d, (W - 40, 266), "— " + author, sk.small, sk.accent, anchor="ra")
        d.rounded_rectangle((22, H - 12, 22 + int(120 * progress), H - 9), radius=2, fill=sk.accent)


# ---------------------------------------------------------------- 19. ambient
class AmbientView(View):
    id, title = "ambient", "Ambient"
    transition = "curtain"

    def __init__(self, accent):
        super().__init__(accent)
        self.now = datetime.now(TZ)
        self.temp = Tween(speed=2)

    def visible(self, st):
        if not self.options.get("nightOnly", True):
            return True
        return bool(st.get("_night"))

    def update(self, st, dt):
        self.tick(dt)
        self.now = datetime.now(TZ)
        i = st.get("inside") or {}
        v = num((i.get("temp") or {}).get("state"))
        if v is not None:
            self.temp.set(v)
        self.temp.step(dt)

    def draw(self, c, t, progress):
        sk = self.sk
        d = ImageDraw.Draw(c)
        s = self.now.strftime("%H:%M")
        # bottom-right, small and dim: readable at night without lighting the room
        # anchor both to the bottom edge ("rd"), so tall skin fonts stack instead of colliding
        sk.text(d, (W - 24, H - 14), f"{self.temp.value:.1f}°C", sk.small, lerp_rgb(sk.muted, sk.bg, 0.2), anchor="rd")
        sk.text(d, (W - 24, H - 14 - sk.small.size - 8), s, sk.big, lerp_rgb(sk.fg, sk.bg, 0.25), anchor="rd")


EXTRA_VIEWS = {v.id: v for v in (FxView, CryptoView, PhotoView, FleetView, ClimateView, CalendarView, PomodoroView, NetworkView, CountdownView, QuoteView, AmbientView)}
