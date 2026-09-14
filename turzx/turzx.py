"""Turzx desk-screen renderer.

  pythonw turzx.py            # logon task vmui-turzx
  python  turzx.py --once    # render each view (every skin) to .copilot-tmp/turzx/*.png, no hardware
  python  turzx.py --once --skin glass

Loop: poll vmui /api/turzx/state every 3 s (settings + HA + feeds), sample
PC metrics locally, tick the active view at `fps`, rotate after the view's
own dwell with a strip-wipe transition, and send only changed pixels over
USB within a per-frame byte budget (link ≈ 365 KB/s). Photo backgrounds are
swapped only at view entry, so the one 300 KB repaint coincides with the
transition that repaints everything anyway.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import threading
import time
import traceback
import urllib.request
from datetime import datetime
from pathlib import Path

import psutil
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from anim import Clock, dirty_rects, transition  # noqa: E402
from backgrounds import Backgrounds  # noqa: E402
from lcd import TurzxLcd  # noqa: E402
from overlay import NotificationOverlay  # noqa: E402
from skins import build as build_skin, font  # noqa: E402
from views import BG, TZ, VIEWS, H, W, hex_rgb  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
LOG = ROOT / ".copilot-tmp" / "service-logs" / "turzx.log"
VMUI = "http://127.0.0.1:3737"
DEBUG = bool(os.environ.get("TURZX_DEBUG"))
LINK_BPS = 365_000  # measured 2026-09-14: 300 KB in 0.823 s, linear down to 3 KB
MIN_DWELL = 5

try:  # 1 ms scheduler tick; default ~15.6 ms makes 20 fps pacing jitter by a whole frame
    import ctypes

    ctypes.windll.winmm.timeBeginPeriod(1)
except Exception:
    pass

try:
    import pynvml  # type: ignore

    pynvml.nvmlInit()
    _GPU = pynvml.nvmlDeviceGetHandleByIndex(0)
except Exception:  # no NVIDIA / driver mid-update
    _GPU = None


def log(msg: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {msg}\n")


def token() -> str:
    if t := os.environ.get("ESP_DISPLAY_TOKEN"):
        return t
    for line in (ROOT / ".private" / "credentials.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("ESP_DISPLAY_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError("ESP_DISPLAY_TOKEN missing")


DEFAULT_BG = {"mode": "none", "sources": [], "folder": "", "dim": 0.45, "blur": 0}
DEFAULT_SETTINGS = {
    "version": 2,
    "views": [{"id": k, "enabled": k in ("clock", "weather", "home", "pc", "media"), "dwellSec": 12, "skin": "minimal", "background": None, "options": {}} for k in VIEWS],
    "fps": 20, "transitionMs": 600, "brightness": 60, "nightBrightness": 15, "nightFrom": "23:00", "nightTo": "07:30",
    "accent": "#7c9cff", "flip": False, "background": DEFAULT_BG, "bgRotateMin": 30,
}


class State:
    """Shared between the poller thread and the render loop."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.data: dict = {"settings": DEFAULT_SETTINGS, "haOnline": False}
        self.online = False
        self.art: Image.Image | None = None
        self.art_url: str | None = None

    def snapshot(self) -> dict:
        with self.lock:
            d = dict(self.data)
        d["pc"] = pc_metrics()
        d["_art"] = self.art
        return d


def pc_metrics() -> dict:
    out = {"cpu": psutil.cpu_percent(interval=None), "ram": psutil.virtual_memory().percent}
    if _GPU is not None:
        try:
            out["gpu"] = pynvml.nvmlDeviceGetUtilizationRates(_GPU).gpu
            out["gpuTemp"] = pynvml.nvmlDeviceGetTemperature(_GPU, 0)
            m = pynvml.nvmlDeviceGetMemoryInfo(_GPU)
            out["vram"] = m.used * 100 / m.total
        except Exception:
            pass
    return out


def poller(st: State, tok: str, stop: threading.Event, bgs: Backgrounds | None) -> None:
    while not stop.is_set():
        try:
            with urllib.request.urlopen(f"{VMUI}/api/turzx/state?k={tok}", timeout=6) as r:
                data = json.loads(r.read())
            with st.lock:
                st.data = data
                st.online = True
            if bgs is not None:
                bgs.set_online(data.get("photos") or [])
            m = next((x for x in data.get("media") or [] if x.get("art")), None)
            url = m["art"] if m else None
            if url and url.startswith("/"):
                ha = (data.get("haUrl") or "").rstrip("/")
                url = f"{ha}{url}" if ha else None
            if url != st.art_url:
                st.art_url = url
                st.art = None
                if url:
                    try:
                        with urllib.request.urlopen(url, timeout=4) as r:
                            st.art = Image.open(io.BytesIO(r.read())).convert("RGB")
                    except Exception:
                        st.art = None
        except Exception as e:
            with st.lock:
                st.online = False
            log(f"poll: {e.__class__.__name__}: {e}")
        stop.wait(3.0)


def night(settings: dict) -> bool:
    now = datetime.now(TZ).strftime("%H:%M")
    a, b = settings.get("nightFrom", "23:00"), settings.get("nightTo", "07:30")
    return (a <= now or now < b) if a > b else (a <= now < b)


_F_TINY = font(15, "r")


def offline_badge(c: Image.Image, online: bool) -> None:
    if online:
        return
    d = ImageDraw.Draw(c)
    d.rounded_rectangle((W - 118, H - 30, W - 8, H - 8), radius=8, fill=(60, 24, 24))
    d.text((W - 63, H - 19), "vmui offline", font=_F_TINY, fill=(252, 165, 165), anchor="mm")


def merge_rects(rects: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    """Greedily merge pairs whose bounding union costs < 25% more bytes than
    sending them apart. Fewer commands, same pixels."""
    rs = list(rects)
    changed = True
    while changed and len(rs) > 1:
        changed = False
        for i in range(len(rs)):
            for j in range(i + 1, len(rs)):
                a, b = rs[i], rs[j]
                u = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
                area = lambda r: (r[2] - r[0]) * (r[3] - r[1])
                if area(u) <= (area(a) + area(b)) * 1.25:
                    rs[i] = u
                    del rs[j]
                    changed = True
                    break
            if changed:
                break
    return rs


def dots(c: Image.Image, i: int, n: int, accent, muted) -> None:
    if n <= 1:
        return
    d = ImageDraw.Draw(c)
    x0 = W // 2 - (n * 12) // 2
    for k in range(n):
        r = 4 if k == i else 2
        d.ellipse((x0 + k * 12 - r, H - 6 - r, x0 + k * 12 + r, H - 6 + r), fill=accent if k == i else muted)


class Renderer:
    def __init__(self, st: State, lcd: TurzxLcd | None, bgs: Backgrounds | None) -> None:
        self.st = st
        self.lcd = lcd
        self.bgs = bgs
        self.settings: dict = {}
        self.accent = hex_rgb(DEFAULT_SETTINGS["accent"])
        self.views = {k: V(self.accent) for k, V in VIEWS.items()}
        self.cfg: dict[str, dict] = {}  # view id -> its config block
        self.order: list[str] = []  # enabled ids in order
        self.idx = 0
        self.dwell_t = time.perf_counter()
        self.trans: tuple[Image.Image, float, str] | None = None
        self.prev: Image.Image | None = None
        self.bright = -1
        self.clock = Clock()
        # background state for the current view
        self.bg_img: Image.Image | None = None
        self.bg_meta: dict = {}
        self.bg_at = 0.0
        self.bg_key: str | None = None
        # remembered per view so passing through a flat view does not reset the photo timer
        self.bg_by_view: dict[str, tuple[Image.Image, dict, str, float]] = {}
        self.overlay = NotificationOverlay()
        self.last_full = time.perf_counter()
        self.apply_settings(DEFAULT_SETTINGS)

    # ---- settings
    def apply_settings(self, s: dict) -> None:
        if s == self.settings:
            return
        if s.get("version") != 2:  # a stale/old-format row: keep defaults
            s = DEFAULT_SETTINGS
        self.settings = {**DEFAULT_SETTINGS, **s}
        self.accent = hex_rgb(self.settings["accent"])
        cfgs = [c for c in self.settings["views"] if c.get("id") in self.views]
        self.cfg = {c["id"]: c for c in cfgs}
        for vid, c in self.cfg.items():
            self.views[vid].configure(c.get("skin") or "minimal", self.accent, c.get("options") or {})
        order = [c["id"] for c in cfgs if c.get("enabled")] or ["clock"]
        if order != self.order:
            cur = self.order[self.idx % len(self.order)] if self.order else None
            self.order = order
            self.idx = order.index(cur) if cur in order else 0
        flip = bool(self.settings.get("flip"))
        if self.lcd and flip != self.lcd.flip:
            self.lcd.set_orientation(True, flip)
            self.prev = None
        self.overlay.configure(self.settings.get("notify") or {})

    def current(self):
        return self.views[self.order[self.idx % len(self.order)]]

    def dwell_of(self, vid: str) -> float:
        return max(MIN_DWELL, float(self.cfg.get(vid, {}).get("dwellSec") or 12))

    def bg_cfg(self, vid: str) -> dict:
        own = self.cfg.get(vid, {}).get("background")
        g = own or self.settings.get("background") or DEFAULT_BG
        if vid == "photo" and g.get("mode") != "photo":
            # the photo view IS the photo; with no photo config it still shows the online pool
            return {**g, "mode": "photo", "sources": g.get("sources") or ["apod", "met", "artic", "commons"]}
        return g

    # ---- rotation
    def advance(self, data: dict) -> None:
        """Next enabled view whose visible() says yes; may stay on the same one."""
        n = len(self.order)
        for k in range(1, n + 1):
            j = (self.idx + k) % n
            if self.views[self.order[j]].visible(data):
                self.idx = j
                return
        self.idx = (self.idx + 1) % n

    def enter_view(self, data: dict, now: float) -> None:
        v = self.current()
        v.enter()
        v.update(data, 0.0)
        self.dwell_t = now
        self.refresh_background(v, force_new=(v.id == "photo"))

    def refresh_background(self, v, force_new: bool = False) -> None:
        cfg = self.bg_cfg(v.id)
        want_photo = cfg.get("mode") == "photo" and (v.wants_photo or v.id == "photo") and v.sk.photo_ok and self.bgs is not None
        if not want_photo:
            self.bg_img, self.bg_meta, self.bg_key = None, {}, None
            return
        rotate_s = max(60.0, float(self.settings.get("bgRotateMin") or 30) * 60)
        remembered = self.bg_by_view.get(v.id)
        if remembered and not force_new and time.time() - remembered[3] < rotate_s:
            self.bg_img, self.bg_meta, self.bg_key, self.bg_at = remembered
            return
        if self.bg_img is not None and not force_new and time.time() - self.bg_at < rotate_s and self.bg_key == (remembered or (None, None, None))[2]:
            return
        srcs = list(cfg.get("sources") or [])
        if self.bgs is not None:
            self.bgs.set_folder(str(cfg.get("folder") or ""))
            got = self.bgs.pick(srcs, exclude=self.bg_key)
            if got:
                self.bg_img, self.bg_meta = got
                self.bg_key = self.bg_meta.get("key")
                self.bg_at = time.time()
                self.bg_by_view[v.id] = (self.bg_img, self.bg_meta, self.bg_key, self.bg_at)

    # ---- frame
    def render(self, now: float, dt: float, data: dict) -> Image.Image:
        v = self.current()
        cfg = self.bg_cfg(v.id)
        photo = self.bg_img if (cfg.get("mode") == "photo" and (v.wants_photo or v.id == "photo")) else None
        dim = float(cfg.get("dim") or 0) if v.id != "photo" else 0.0
        blur = int(cfg.get("blur") or 0) if v.id != "photo" else 0
        c = v.sk.base((W, H), photo, dim, blur)
        data["_bgmeta"] = self.bg_meta
        data["_night"] = night(self.settings)
        v.update(data, dt)
        progress = 1.0 - min(1.0, (now - self.dwell_t) / self.dwell_of(v.id))
        v.draw(c, now - v.t0, progress)
        dots(c, self.idx % len(self.order), len(self.order), v.sk.accent, v.sk.track)
        offline_badge(c, self.st.online)
        return c

    def step(self) -> Image.Image:
        dt = self.clock.tick()
        now = time.perf_counter()
        data = self.st.snapshot()
        self.apply_settings(data.get("settings") or {})
        v = self.current()
        due = now - self.dwell_t >= self.dwell_of(v.id)
        # a view that became invisible mid-dwell (pomodoro stopped) leaves early
        gone = not v.visible(data) and len(self.order) > 1
        if (due or gone) and len(self.order) > 1 and self.trans is None:
            old = self.render(now, dt, data)
            self.advance(data)
            self.enter_view(data, now)
            self.trans = (old, now, self.current().transition)
        elif self.bg_img is None and self.bg_cfg(v.id).get("mode") == "photo":
            self.refresh_background(v)  # a photo became ready after we entered
        frame = self.render(now, dt, data)
        if self.trans is not None:
            old, t0, kind = self.trans
            tm = max(1, self.settings["transitionMs"]) / 1000
            p = (now - t0) / tm
            if p >= 1.0:
                self.trans = None
            else:
                frame = transition(old, frame, p, kind)
        # phone notifications ride on top of everything
        present = ((data.get("home") or {}).get("presence") or {}).get("state") == "on"
        self.overlay.offer(data.get("notification"), present)
        self.overlay.step(now, dt)
        if self.overlay.active:
            self.dwell_t += dt  # pause the rotation while a card is up
            drew = self.overlay.draw(frame, now)
            if DEBUG and drew and not getattr(self, "_ov_logged", False):
                self._ov_logged = True
                log(f"overlay: showing {self.overlay.cur.get('pkg')} / {self.overlay.cur.get('title')}")
        elif getattr(self, "_ov_logged", False):
            self._ov_logged = False
        want = self.settings["nightBrightness"] if night(self.settings) else self.settings["brightness"]
        if self.lcd and want != self.bright:
            self.lcd.set_brightness(int(want))
            self.bright = want
        return frame

    def push(self, frame: Image.Image) -> int:
        """Send what changed, capped at what the link moves in one frame period.
        Rects that do not fit are sliced into row bands and finished on later
        frames; `self.prev` tracks what is actually on the panel, so nothing is lost."""
        if not self.lcd:
            return 0
        t0 = time.perf_counter()
        budget = int(LINK_BPS / max(5, min(30, self.settings["fps"])))
        rects = dirty_rects(self.prev, frame)
        # Fewer commands per frame: merge rects whose union is barely bigger
        # than their sum. The panel occasionally drops a command header when
        # they come densely; every merged pair is one fewer chance to desync.
        rects = merge_rects(rects)
        # Watchdog: every 20 s, in a quiet frame, resync the panel's command
        # parser and repaint everything. A desynced panel looks exactly like a
        # frozen one, and re-init is the only thing that recovers it.
        if self.prev is not None and time.perf_counter() - self.last_full > 20 and not rects:
            self.lcd.resync()
            rects = [(0, 0, W, H)]
            self.last_full = time.perf_counter()
        total = sum((x1 - x0) * (y1 - y0) * 2 for x0, y0, x1, y1 in rects)
        rects.sort(key=lambda r: (r[2] - r[0]) * (r[3] - r[1]), reverse=total <= budget)
        # a notification card must land whole and first, whatever else is dirty
        ov = self.overlay.rect if self.overlay.active else None
        if ov:
            def hits(r):
                return not (r[2] <= ov[0] or r[0] >= ov[2] or r[3] <= ov[1] or r[1] >= ov[3])
            rects.sort(key=lambda r: 0 if hits(r) else 1)
        if self.prev is None:
            self.prev = Image.new("RGB", frame.size, (1, 2, 3))
        shown = self.prev.copy()
        sent = 0
        for (x0, y0, x1, y1) in rects:
            size = (x1 - x0) * (y1 - y0) * 2
            if sent + size > budget:
                rows = (budget - sent) // ((x1 - x0) * 2)
                if rows < 4:
                    break
                y1 = y0 + rows
            region = frame.crop((x0, y0, x1, y1))
            sent += self.lcd.blit(region, x0, y0)
            shown.paste(region, (x0, y0))
            if sent >= budget:
                break
            self.prev = shown
        if DEBUG and rects:
            log(f"t={t0:.3f} push {len(rects)} rects {sent/1024:.1f} KB in {(time.perf_counter()-t0)*1000:.0f} ms")
        return sent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="render each view to PNG, no hardware")
    ap.add_argument("--skin", help="with --once: force this skin for every view")
    ap.add_argument("--all-skins", action="store_true", help="with --once: one PNG per view per skin")
    ap.add_argument("--port")
    ap.add_argument("--demo-notify", action="store_true", help="pop a fake WhatsApp card 5 s after start (hardware test)")
    args = ap.parse_args()

    st = State()
    stop = threading.Event()
    bgs = Backgrounds(ROOT / ".copilot-tmp" / "turzx" / "bg")
    threading.Thread(target=poller, args=(st, token(), stop, bgs), daemon=True).start()
    time.sleep(1.5)

    if args.once:
        out = ROOT / ".copilot-tmp" / "turzx"
        out.mkdir(parents=True, exist_ok=True)
        r = Renderer(st, None, bgs)
        r.apply_settings((st.snapshot().get("settings") or {}))
        skins = ["minimal", "glass", "neon", "editorial", "terminal", "paper"] if args.all_skins else [args.skin] if args.skin else [None]
        time.sleep(6)  # let a couple of backgrounds download
        for vid in VIEWS:
            for sk in skins:
                v = r.views[vid]
                if sk:
                    v.configure(sk, r.accent, r.cfg.get(vid, {}).get("options") or {})
                r.idx = r.order.index(vid) if vid in r.order else 0
                r.order = list(dict.fromkeys([*r.order, vid]))
                r.idx = r.order.index(vid)
                data = st.snapshot()
                data["pomodoro"] = data.get("pomodoro") if (data.get("pomodoro") or {}).get("phase", "idle") != "idle" else {"phase": "work", "startedAt": time.time() * 1000 - 300000, "endsAt": time.time() * 1000 + 1200000, "round": 2}
                r.enter_view(data, time.perf_counter())
                if r.bg_img is None and r.bg_cfg(vid).get("mode") == "photo":
                    r.refresh_background(v, force_new=True)
                for _ in range(30):
                    v.update(data, 0.1)
                r.dwell_t = time.perf_counter() - r.dwell_of(vid) * 0.35
                c = r.render(time.perf_counter(), 0.1, data)
                name = f"{vid}{'-' + sk if sk else ''}.png"
                c.save(out / name)
                print("wrote", out / name)
        return 0

    while True:
        try:
            lcd = TurzxLcd(args.port, landscape=True, flip=bool((st.snapshot().get("settings") or {}).get("flip")))
            lcd.init(60)
            log(f"connected {lcd.ser.port} (rev A protocol)")
            r = Renderer(st, lcd, bgs)
            r.enter_view(st.snapshot(), time.perf_counter())
            if args.demo_notify:
                r.overlay.primed = True
                r.overlay.presence_only = False
                r.overlay.packages = set()
                threading.Timer(5.0, lambda: r.overlay.queue.append({"id": "demo", "pkg": "com.whatsapp", "app": "whatsapp", "title": "Mama", "text": "Ai mâncat ceva azi? Sună-mă când poți, vreau să te întreb ceva despre weekend."})).start()
            frames = 0
            t_stat = time.perf_counter()
            px = 0
            next_t = time.perf_counter()
            while True:
                t = time.perf_counter()
                frame = r.step()
                px += r.push(frame)
                frames += 1
                if t - t_stat >= 60:
                    log(f"{frames/60:.1f} fps, {px/60/1024:.0f} KB/s, view={r.current().id} skin={r.current().sk.id}")
                    frames, px, t_stat = 0, 0, t
                budget = 1.0 / max(5, min(30, r.settings["fps"]))
                next_t += budget
                now = time.perf_counter()
                if now > next_t + budget:
                    next_t = now
                rem = next_t - now
                if rem > 0.003:
                    time.sleep(rem - 0.002)
                while time.perf_counter() < next_t:
                    pass
        except KeyboardInterrupt:
            return 0
        except Exception as e:
            tb = traceback.extract_tb(e.__traceback__)[-1]
            log(f"lcd: {e.__class__.__name__}: {e} @ {Path(tb.filename).name}:{tb.lineno}; reconnecting in 5 s")
            try:
                lcd.close()  # type: ignore[possibly-undefined]
            except Exception:
                pass
            time.sleep(5)


if __name__ == "__main__":
    sys.exit(main())
