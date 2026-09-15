"""Follow the video window on the movie monitor and steer HyperHDR.

HyperHDR's DX11 grabber captures the WHOLE Odyssey. A YouTube tab that is not
fullscreen covers about half of it; the rest is a static desktop, so every
edge LED averaged to grey and "movie mode does nothing". Two jobs here:

  * crop:   find the video window on the movie monitor and set the global
            systemGrabber crop to its client rectangle, so HyperHDR only sees
            the picture. Fullscreen/no window -> crop 0. Crop is global in
            HyperHDR, so every instance follows it (what a film wants).
  * mode:   a video window present for ON_AFTER_S -> script.movie_mode_on;
            gone for OFF_AFTER_S -> script.movie_mode_off. Only fires on the
            edge, so the tray/HA can still override until the next edge.

"Video window" = any visible top-level browser or player window whose centre
is on the movie monitor (the user asked for permissive: a news tab counts).
Player process names decide; add to PLAYERS / BROWSERS.

Inside a browser the PLAYER is smaller than the window: a maximized YouTube
tab on the 21:9 Odyssey pillarboxes the 16:9 video to x 440..3000 with page
chrome around it (measured). So the window rect is only the coarse box; the
fine box is where pixels actually CHANGE between two grabs ~0.4 s apart,
refined every REFINE_S seconds (mss, ~40 ms per pair). A refinement is
accepted only when >= MIN_MOTION of its box moved, so a paused film keeps
the previous box instead of collapsing to nothing. A calm scene where only
a face moves must not shrink the box to the face either: once a box is
established for a window rect it may only GROW (union) until the window
moves/resizes -- a picture never gets smaller while the window stays put.

Runs as a bridges.py thread (no UDP port). Standalone:
  python video_follow.py --once       print what would be done
  python video_follow.py --listen 0   run the loop
Deps (same interpreter as bridges.py): pip install mss numpy websocket-client
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as w
import json
import os
import re
import sys
import time
import urllib.request

import numpy as np
from mss import MSS

HERE = os.path.dirname(os.path.abspath(__file__))
CRED = os.path.join(os.path.dirname(HERE), ".private", "credentials.env")
SETTINGS = os.path.join(HERE, "settings.json")
HYPER_WS = os.environ.get("HYPERHDR_WS", "ws://127.0.0.1:8090")

# Movie monitor: the Odyssey is the non-primary display at x<0. Matched by
# device name so a display re-enumeration (DISPLAY23 -> DISPLAY25) still works.
MOVIE_MONITOR_NAME_RE = re.compile(r"Odyssey|SAME063", re.I)

PLAYERS = {"vlc.exe", "mpv.exe", "mpc-hc64.exe", "mpc-be64.exe", "plex.exe", "plexmediaplayer.exe", "video.ui.exe",
           "wmplayer.exe", "potplayermini64.exe", "kodi.exe", "stremio.exe", "jellyfin media player.exe"}
BROWSERS = {"chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe", "arc.exe", "zen.exe"}
# Chromium PWAs (YouTube / Netflix "installed" apps) are chrome.exe/msedge.exe
# with an --app id; their title has no " - Google Chrome" suffix. Covered by
# BROWSERS + centre-on-monitor, no title rule needed.

POLL_S = 1.0
REFINE_S = 5.0
# Re-read the crop HyperHDR actually holds: `ambilight.ps1 -Configure` (or the
# HyperHDR UI) rewrites systemGrabber with crop 0 and our cached value would
# say "already set" forever -- the outer 8 % then reads the black pillarbox.
VERIFY_S = 15.0
ON_AFTER_S = 5.0
OFF_AFTER_S = 30.0
# Ignore windows smaller than this share of the monitor (a floating chat).
MIN_AREA = 0.15
# Motion box: a pixel "moved" above this per-channel delta; a row/column is
# part of the picture when this share of it moved; accept the box when this
# share of the coarse box moved at all.
MOTION_DELTA = 12
MOTION_LINE = 0.15
MIN_MOTION = 0.05
# The FIRST box for a window rect must cover this share of the window's
# area, otherwise a calm scene would seed a tiny box that takes minutes to
# grow; until then the whole window is used.
SEED_AREA = 0.30
# Round crops to this many px so a 1 px jitter does not rewrite the config.
QUANT = 8

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
dwmapi = ctypes.windll.dwmapi
DWMWA_EXTENDED_FRAME_BOUNDS = 9
DWMWA_CLOAKED = 14


class MONITORINFOEXW(ctypes.Structure):
    _fields_ = [("cbSize", w.DWORD), ("rcMonitor", w.RECT), ("rcWork", w.RECT), ("dwFlags", w.DWORD), ("szDevice", w.WCHAR * 32)]


def _monitors() -> list[tuple[str, tuple[int, int, int, int]]]:
    out: list[tuple[str, tuple[int, int, int, int]]] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(w.RECT), ctypes.c_void_p)
    def cb(hmon, _hdc, _rc, _lp):
        mi = MONITORINFOEXW()
        mi.cbSize = ctypes.sizeof(mi)
        if user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
            r = mi.rcMonitor
            out.append((mi.szDevice, (r.left, r.top, r.right, r.bottom)))
        return True

    user32.EnumDisplayMonitors(None, None, cb, 0)
    return out


def _friendly_names() -> dict[str, str]:
    """\\\\.\\DISPLAY23 -> 'Odyssey G85SD' via EnumDisplayDevices + the EDID name in the registry path."""
    names: dict[str, str] = {}

    class DISPLAY_DEVICEW(ctypes.Structure):
        _fields_ = [("cb", w.DWORD), ("DeviceName", w.WCHAR * 32), ("DeviceString", w.WCHAR * 128), ("StateFlags", w.DWORD),
                    ("DeviceID", w.WCHAR * 128), ("DeviceKey", w.WCHAR * 128)]

    i = 0
    while True:
        dd = DISPLAY_DEVICEW()
        dd.cb = ctypes.sizeof(dd)
        if not user32.EnumDisplayDevicesW(None, i, ctypes.byref(dd), 0):
            break
        mon = DISPLAY_DEVICEW()
        mon.cb = ctypes.sizeof(mon)
        if user32.EnumDisplayDevicesW(dd.DeviceName, 0, ctypes.byref(mon), 1):
            names[dd.DeviceName] = mon.DeviceID  # MONITOR\SAME063\{...}
        i += 1
    return names


def movie_monitor() -> tuple[str, tuple[int, int, int, int]] | None:
    ids = _friendly_names()
    mons = _monitors()
    for dev, rect in mons:
        if MOVIE_MONITOR_NAME_RE.search(ids.get(dev, "")):
            return dev, rect
    # Fallback: the left-most non-primary monitor (the film screen sits left of the Philips).
    non_primary = [m for m in mons if m[1][0] != 0 or m[1][1] != 0]
    return min(non_primary, key=lambda m: m[1][0]) if non_primary else None


def _proc_name(hwnd) -> str:
    pid = w.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    h = kernel32.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(512)
        n = w.DWORD(512)
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
            return os.path.basename(buf.value).lower()
        return ""
    finally:
        kernel32.CloseHandle(h)


def _frame_rect(hwnd) -> tuple[int, int, int, int]:
    r = w.RECT()
    if dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(r), ctypes.sizeof(r)) != 0:
        user32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def _cloaked(hwnd) -> bool:
    v = w.DWORD()
    return dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, ctypes.byref(v), ctypes.sizeof(v)) == 0 and v.value != 0


def find_video_window(mon: tuple[int, int, int, int]) -> tuple[str, str, tuple[int, int, int, int]] | None:
    """Top-most (z-order) visible browser/player whose centre is on `mon`."""
    ml, mt, mr, mb = mon
    marea = (mr - ml) * (mb - mt)
    hits: list[tuple[str, str, tuple[int, int, int, int]]] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def cb(hwnd, _lp):
        if not user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd) or _cloaked(hwnd):
            return True
        title = ctypes.create_unicode_buffer(512)
        if not user32.GetWindowTextW(hwnd, title, 512) or not title.value:
            return True
        proc = _proc_name(hwnd)
        if proc not in PLAYERS and proc not in BROWSERS:
            return True
        l, t, r, b = _frame_rect(hwnd)
        cx, cy = (l + r) // 2, (t + b) // 2
        if not (ml <= cx < mr and mt <= cy < mb):
            return True
        if (r - l) * (b - t) < MIN_AREA * marea:
            return True
        hits.append((proc, title.value, (l, t, r, b)))
        return True

    user32.EnumWindows(cb, 0)  # EnumWindows yields top-most first
    return hits[0] if hits else None


def crop_for(win: tuple[int, int, int, int], mon: tuple[int, int, int, int]) -> dict[str, int]:
    l, t, r, b = win
    ml, mt, mr, mb = mon
    q = lambda v: max(0, (v // QUANT) * QUANT)  # noqa: E731
    left, top, right, bottom = q(l - ml), q(t - mt), q(mr - r), q(mb - b)
    if left + right >= (mr - ml) - 200 or top + bottom >= (mb - mt) - 200:
        return {"cropLeft": 0, "cropRight": 0, "cropTop": 0, "cropBottom": 0}
    return {"cropLeft": left, "cropRight": right, "cropTop": top, "cropBottom": bottom}


def motion_box(win: tuple[int, int, int, int], sct: MSS, gap_s: float = 0.4) -> tuple[int, int, int, int] | None:
    """Sub-rectangle of `win` (screen coords) where the picture moves, or None if too still."""
    l, t, r, b = win
    region = {"left": l, "top": t, "width": r - l, "height": b - t}
    a = np.asarray(sct.grab(region))[:, :, :3].astype(np.int16)
    time.sleep(gap_s)
    c = np.asarray(sct.grab(region))[:, :, :3].astype(np.int16)
    moved = np.abs(a - c).max(axis=2) > MOTION_DELTA
    if moved.mean() < MIN_MOTION:
        return None
    rows = np.where(moved.mean(axis=1) > MOTION_LINE)[0]
    cols = np.where(moved.mean(axis=0) > MOTION_LINE)[0]
    if len(rows) < 50 or len(cols) < 50:
        return None
    return l + int(cols[0]), t + int(rows[0]), l + int(cols[-1]) + 1, t + int(rows[-1]) + 1


# ---------------------------------------------------------------- HyperHDR / HA

def _creds() -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        with open(CRED, encoding="utf-8") as fh:
            for line in fh:
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip().strip('"')
    except OSError:
        pass
    for k in ("HA_URL", "HA_TOKEN", "HYPERHDR_ADMIN_PASS"):
        if os.environ.get(k):
            out[k] = os.environ[k]
    return out


class Hyper:
    def __init__(self, password: str) -> None:
        self.password = password

    def _session(self, commands: list[dict], timeout: float = 5.0) -> list[dict]:
        import websocket  # websocket-client  # noqa: PLC0415

        ws = websocket.create_connection(HYPER_WS, timeout=timeout, max_size=None)
        tan = 0

        def send(o: dict) -> dict:
            nonlocal tan
            tan += 1
            ws.send(json.dumps({**o, "tan": tan}))
            while True:
                r = json.loads(ws.recv())
                if r.get("tan") == tan:
                    return r

        try:
            a = send({"command": "authorize", "subcommand": "login", "password": self.password})
            if not a.get("success"):
                raise RuntimeError(f"login: {a.get('error')}")
            out = []
            for c in commands:
                r = send(c)
                if not r.get("success"):
                    raise RuntimeError(f"{c.get('command')}/{c.get('subcommand')}: {r.get('error')}")
                out.append(r)
            return out
        finally:
            ws.close()

    def get_crop(self) -> dict[str, int]:
        g = self._session([{"command": "config", "subcommand": "getconfig"}])[0]["info"]["systemGrabber"]
        return {k: int(g.get(k, 0)) for k in ("cropLeft", "cropRight", "cropTop", "cropBottom")}

    def set_crop(self, crop: dict[str, int]) -> None:
        # HyperHDR's setconfig is a REPLACE of the instance config, not a
        # merge: sending only systemGrabber reset device/leds, and sending
        # systemGrabber+device+leds silently dropped smoothing, backgroundEffect,
        # soundEffect and mqtt (measured 2026-09-15 -- the strip snapped on
        # every cut, "flashes after pause"). Send the WHOLE config back with
        # only the crop fields changed.
        cfg = self._session([{"command": "config", "subcommand": "getconfig"}])[0]["info"]
        cfg["systemGrabber"] = {**cfg["systemGrabber"], **crop}
        self._session([{"command": "config", "subcommand": "setconfig", "config": cfg}])


def ha_script(name: str, creds: dict[str, str]) -> None:
    url, tok = creds.get("HA_URL", "").rstrip("/"), creds.get("HA_TOKEN", "")
    if not url or not tok:
        raise RuntimeError("HA_URL/HA_TOKEN missing")
    req = urllib.request.Request(f"{url}/api/services/script/{name}", data=b"{}", method="POST",
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=8).read()


def _setting(key: str, default):
    try:
        with open(SETTINGS, encoding="utf-8") as fh:
            return json.load(fh).get(key, default)
    except (OSError, ValueError):
        return default


# ---------------------------------------------------------------- loop

class VideoFollow:
    def __init__(self) -> None:
        self.creds = _creds()
        self.hyper = Hyper(self.creds.get("HYPERHDR_ADMIN_PASS", "hyperhdr"))
        self.sct = MSS()
        self.crop: dict[str, int] | None = None
        self.seen_since: float | None = None
        self.gone_since: float | None = None
        self.movie_on: bool | None = None  # unknown until the first edge
        self.last_desc = ""
        self.fine: tuple[int, int, int, int] | None = None
        self.fine_for: tuple[int, int, int, int] | None = None  # coarse rect the fine box belongs to
        self.next_refine = 0.0
        self.next_verify = 0.0

    def describe(self) -> None:
        mm = movie_monitor()
        print(f"  movie monitor: {mm[0] if mm else 'NOT FOUND'} {mm[1] if mm else ''}", flush=True)
        try:
            self.crop = self.hyper.get_crop()
            print(f"  HyperHDR crop now {self.crop}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"  HyperHDR unreachable: {e}", flush=True)

    def _apply_crop(self, crop: dict[str, int]) -> None:
        if crop == self.crop:
            return
        self.hyper.set_crop(crop)
        self.crop = crop
        print(f"  crop -> L{crop['cropLeft']} R{crop['cropRight']} T{crop['cropTop']} B{crop['cropBottom']}", flush=True)

    def _set_movie(self, on: bool) -> None:
        if self.movie_on is on:
            return
        ha_script("movie_mode_on" if on else "movie_mode_off", self.creds)
        self.movie_on = on
        print(f"  movie mode {'ON' if on else 'OFF'} (video window {'present' if on else 'gone'})", flush=True)

    def step(self) -> None:
        if not _setting("videoFollow", True):
            return
        now = time.monotonic()
        if now >= self.next_verify:
            self.next_verify = now + VERIFY_S
            live = self.hyper.get_crop()
            if self.crop is not None and live != self.crop:
                print(f"  crop was rewritten externally ({live}); re-applying", flush=True)
            self.crop = live
        mm = movie_monitor()
        if not mm:
            return
        win = find_video_window(mm[1])
        if win:
            proc, title, rect = win
            desc = f"{proc} {title[:50]!r} {rect}"
            if desc != self.last_desc:
                print(f"  video window: {desc}", flush=True)
                self.last_desc = desc
            if rect != self.fine_for:
                self.fine, self.fine_for, self.next_refine = None, rect, 0.0
            if proc in BROWSERS and now >= self.next_refine:
                self.next_refine = now + REFINE_S
                box = motion_box(rect, self.sct)
                if box:
                    if self.fine:
                        box = (min(box[0], self.fine[0]), min(box[1], self.fine[1]), max(box[2], self.fine[2]), max(box[3], self.fine[3]))
                    elif (box[2] - box[0]) * (box[3] - box[1]) < SEED_AREA * (rect[2] - rect[0]) * (rect[3] - rect[1]):
                        box = None
                    if box and box != self.fine:
                        self.fine = box
                        print(f"  picture box: {box}", flush=True)
            self._apply_crop(crop_for(self.fine or rect, mm[1]))
            self.gone_since = None
            self.seen_since = self.seen_since or now
            if _setting("videoAutoMovie", True) and now - self.seen_since >= ON_AFTER_S:
                self._set_movie(True)
        else:
            if self.last_desc:
                print("  video window: none", flush=True)
                self.last_desc = ""
            self._apply_crop({"cropLeft": 0, "cropRight": 0, "cropTop": 0, "cropBottom": 0})
            self.fine = self.fine_for = None
            self.seen_since = None
            self.gone_since = self.gone_since or now
            if _setting("videoAutoMovie", True) and now - self.gone_since >= OFF_AFTER_S:
                self._set_movie(False)


def run_listen(vf: VideoFollow, _port: int) -> None:
    while True:
        try:
            vf.step()
        except Exception as e:  # noqa: BLE001 -- HyperHDR restarting, HA down: keep polling
            print(f"  video_follow: {e}", flush=True)
            time.sleep(5)
        time.sleep(POLL_S)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--listen", type=int, metavar="PORT")
    a = ap.parse_args()
    vf = VideoFollow()
    vf.describe()
    if a.once:
        mm = movie_monitor()
        win = find_video_window(mm[1]) if mm else None
        print("  video window:", win)
        if win and mm:
            box = motion_box(win[2], vf.sct)
            print("  picture box:", box)
            print("  would crop:", crop_for(box or win[2], mm[1]))
        return 0
    run_listen(vf, a.listen or 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
