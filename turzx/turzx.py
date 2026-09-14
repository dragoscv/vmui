"""Turzx desk-screen renderer.

  pythonw turzx.py            # logon task vmui-turzx
  python  turzx.py --once    # render one frame of each view to .copilot-tmp/turzx/*.png (no hardware)

Loop: poll vmui /api/turzx/state every 3 s (settings + HA + lists), sample
PC metrics locally every 0.5 s, tick the active view at `fps`, rotate after
`dwellSec` with a `transitionMs` transition, and send only dirty row bands
over USB. Brightness follows the night window from settings.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import threading
import time
import urllib.request
from datetime import datetime
from pathlib import Path

import psutil
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from anim import Clock, dirty_rects, transition  # noqa: E402
from lcd_rev_b import TurzxLcd  # noqa: E402
from views import BG, FG, MUTED, TZ, VIEWS, W, H, F_SMALL, F_TINY, hex_rgb  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
LOG = ROOT / ".copilot-tmp" / "service-logs" / "turzx.log"
VMUI = "http://127.0.0.1:3737"

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


DEFAULT_SETTINGS = {"views": list(VIEWS), "dwellSec": 12, "fps": 20, "transitionMs": 600, "brightness": 60, "nightBrightness": 15, "nightFrom": "23:00", "nightTo": "07:30", "accent": "#7c9cff"}


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


_cpu_last = 0.0


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


def poller(st: State, tok: str, stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            with urllib.request.urlopen(f"{VMUI}/api/turzx/state?k={tok}", timeout=4) as r:
                data = json.loads(r.read())
            with st.lock:
                st.data = data
                st.online = True
            # album art (best effort, only when URL changes)
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


def offline_badge(c: Image.Image, online: bool) -> None:
    if online:
        return
    d = ImageDraw.Draw(c)
    d.rounded_rectangle((W - 118, H - 30, W - 8, H - 8), radius=8, fill=(60, 24, 24))
    d.text((W - 63, H - 19), "vmui offline", font=F_TINY, fill=(252, 165, 165), anchor="mm")


def dots(c: Image.Image, i: int, n: int, accent) -> None:
    d = ImageDraw.Draw(c)
    x0 = W // 2 - (n * 12) // 2
    for k in range(n):
        r = 4 if k == i else 2
        d.ellipse((x0 + k * 12 - r, H - 6 - r, x0 + k * 12 + r, H - 6 + r), fill=accent if k == i else (60, 62, 76))


class Renderer:
    def __init__(self, st: State, lcd: TurzxLcd | None) -> None:
        self.st = st
        self.lcd = lcd
        self.settings = dict(DEFAULT_SETTINGS)
        self.accent = hex_rgb(self.settings["accent"])
        self.views = {k: V(self.accent) for k, V in VIEWS.items()}
        self.order = list(self.settings["views"])
        self.idx = 0
        self.dwell_t = time.perf_counter()
        self.trans: tuple[Image.Image, float, str] | None = None  # (from frame, start, kind)
        self.prev: Image.Image | None = None
        self.bright = -1
        self.clock = Clock()

    def apply_settings(self, s: dict) -> None:
        if s == self.settings:
            return
        self.settings = {**DEFAULT_SETTINGS, **s}
        acc = hex_rgb(self.settings["accent"])
        if acc != self.accent:
            self.accent = acc
            for v in self.views.values():
                v.accent = acc
        order = [v for v in self.settings["views"] if v in self.views] or list(VIEWS)
        if order != self.order:
            self.order = order
            self.idx = 0

    def current(self):
        return self.views[self.order[self.idx % len(self.order)]]

    def render(self, now: float, dt: float, data: dict) -> Image.Image:
        c = Image.new("RGB", (W, H), BG)
        v = self.current()
        v.update(data, dt)
        v.draw(c, now - v.t0)
        dots(c, self.idx % len(self.order), len(self.order), self.accent)
        offline_badge(c, self.st.online)
        return c

    def step(self) -> Image.Image:
        dt = self.clock.tick()
        now = time.perf_counter()
        data = self.st.snapshot()
        self.apply_settings(data.get("settings") or {})
        # rotate
        if now - self.dwell_t >= self.settings["dwellSec"] and len(self.order) > 1 and self.trans is None:
            old = self.render(now, dt, data)
            self.idx = (self.idx + 1) % len(self.order)
            self.current().enter()
            # pre-tick the new view so its tweens do not start at 0
            self.current().update(data, 0.0)
            self.trans = (old, now, self.current().transition)
            self.dwell_t = now
        frame = self.render(now, dt, data)
        if self.trans is not None:
            old, t0, kind = self.trans
            tm = max(1, self.settings["transitionMs"]) / 1000
            p = (now - t0) / tm
            if p >= 1.0:
                self.trans = None
            else:
                frame = transition(old, frame, p, kind)
        # brightness
        want = self.settings["nightBrightness"] if night(self.settings) else self.settings["brightness"]
        if self.lcd and want != self.bright:
            self.lcd.set_brightness(int(want))
            self.bright = want
        return frame

    def push(self, frame: Image.Image) -> int:
        if not self.lcd:
            return 0
        rects = dirty_rects(self.prev, frame, tile=40)
        sent = 0
        for (x0, y0, x1, y1) in rects:
            self.lcd.blit(frame.crop((x0, y0, x1, y1)), x0, y0)
            sent += (x1 - x0) * (y1 - y0)
        self.prev = frame
        return sent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="render each view to PNG, no hardware")
    ap.add_argument("--port")
    args = ap.parse_args()

    st = State()
    stop = threading.Event()
    threading.Thread(target=poller, args=(st, token(), stop), daemon=True).start()
    time.sleep(1.5)

    if args.once:
        out = ROOT / ".copilot-tmp" / "turzx"
        out.mkdir(parents=True, exist_ok=True)
        r = Renderer(st, None)
        data = st.snapshot()
        for vid in r.order:
            v = r.views[vid]
            for _ in range(30):  # let tweens settle
                v.update(data, 0.1)
            c = Image.new("RGB", (W, H), BG)
            v.draw(c, 1.7)
            dots(c, r.order.index(vid), len(r.order), r.accent)
            offline_badge(c, st.online)
            c.save(out / f"{vid}.png")
            print("wrote", out / f"{vid}.png")
        return 0

    while True:
        try:
            lcd = TurzxLcd(args.port)
            sub = lcd.hello()
            lcd.init(60)
            log(f"connected {lcd.ser.port} sub-rev {sub:#x}")
            r = Renderer(st, lcd)
            frames = 0
            t_stat = time.perf_counter()
            px = 0
            while True:
                t = time.perf_counter()
                frame = r.step()
                px += r.push(frame)
                frames += 1
                if t - t_stat >= 60:
                    log(f"{frames/60:.1f} fps, {px/60/1024:.0f} KB/s, view={r.current().id}")
                    frames, px, t_stat = 0, 0, t
                budget = 1.0 / max(5, min(30, r.settings["fps"]))
                time.sleep(max(0.0, budget - (time.perf_counter() - t)))
        except KeyboardInterrupt:
            return 0
        except Exception as e:
            log(f"lcd: {e.__class__.__name__}: {e}; reconnecting in 5 s")
            try:
                lcd.close()  # type: ignore[possibly-undefined]
            except Exception:
                pass
            time.sleep(5)


if __name__ == "__main__":
    sys.exit(main())
