"""vmui tray: one icon for the whole home stack (ambilight + web UI + ESP).

Runs at logon via the `vmui-tray` scheduled task (pythonw, no console).
The menu talks to:
  - HyperHDR JSON-API (ws://127.0.0.1:8090)      mode / capture / effects
  - vmui HTTP (http://127.0.0.1:3737)             health, wall compensation
  - Task Scheduler (schtasks)                    restart the stack
  - Home Assistant REST (HA_URL/HA_TOKEN)         room lights via scripts

Blue LED rule for the icon: green dot = everything answers, amber = one
piece is down, red = HyperHDR is unreachable.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import pystray
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
CRED = ROOT / ".private" / "credentials.env"
LOG = ROOT / ".copilot-tmp" / "service-logs" / "tray.log"
HYPER_WS = "ws://127.0.0.1:8090"
VMUI = "http://127.0.0.1:3737"
PUBLIC = "https://mui.dragoscatalin.ro/home"
HYPER_UI = "http://127.0.0.1:8090"

TASKS = ["vmui-ambilight-hyperhdr", "vmui-ambilight-openrgb", "vmui-ambilight-dxlight", "vmui-ambilight-pcglow", "vmui-service"]


def log(msg: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {msg}\n")


def creds() -> dict[str, str]:
    out: dict[str, str] = {}
    if CRED.exists():
        for line in CRED.read_text(encoding="utf-8").splitlines():
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"')
    out.update({k: v for k, v in os.environ.items() if k in ("HA_URL", "HA_TOKEN", "HYPERHDR_ADMIN_PASS")})
    return out


C = creds()

# ---------------------------------------------------------------- HyperHDR

def hyper(commands: list[dict], instance: int = 0, timeout: float = 4.0) -> list[dict]:
    """Same session rules as scripts/lib/hyperhdr.ps1: login -> switchTo -> cmds."""
    import websocket  # websocket-client, installed with pystray deps

    ws = websocket.create_connection(HYPER_WS, timeout=timeout)
    tan = 0

    def send(o: dict) -> dict:
        nonlocal tan
        tan += 1
        o = {**o, "tan": tan}
        ws.send(json.dumps(o))
        while True:
            r = json.loads(ws.recv())
            if r.get("tan") == tan:
                return r

    try:
        a = send({"command": "authorize", "subcommand": "login", "password": C.get("HYPERHDR_ADMIN_PASS", "hyperhdr")})
        if not a.get("success"):
            raise RuntimeError(a.get("error"))
        if instance:
            send({"command": "instance", "subcommand": "switchTo", "instance": instance})
        out = []
        for c in commands:
            r = send(c)
            if not r.get("success"):
                raise RuntimeError(f"{c.get('command')}: {r.get('error')}")
            out.append(r)
        return out
    finally:
        ws.close()


def hyper_all(commands: list[dict]) -> None:
    for i in (0, 1, 2):
        try:
            hyper(commands, i)
        except Exception as e:  # one dead instance must not block the others
            log(f"hyper inst {i}: {e}")


def hyper_info() -> dict | None:
    try:
        return hyper([{"command": "serverinfo"}])[0]["info"]
    except Exception:
        return None


# ---------------------------------------------------------------- HA

def ha_script(name: str) -> None:
    url, tok = C.get("HA_URL", "").rstrip("/"), C.get("HA_TOKEN", "")
    if not url or not tok:
        return
    req = urllib.request.Request(f"{url}/api/services/script/{name}", data=b"{}", method="POST",
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except Exception as e:
        log(f"ha script {name}: {e}")


# ---------------------------------------------------------------- health

def vmui_ok() -> bool:
    try:
        urllib.request.urlopen(f"{VMUI}/api/health", timeout=3)
        return True
    except Exception as e:  # 307 -> sign-in still means the server is up
        return getattr(e, "code", 0) in (301, 302, 307, 401, 403)


def task_running(name: str) -> bool:
    r = subprocess.run(["schtasks", "/query", "/tn", name, "/fo", "csv", "/nh"], capture_output=True, text=True, creationflags=0x08000000)
    return "Running" in r.stdout


def start_task(name: str) -> None:
    subprocess.run(["schtasks", "/run", "/tn", name], capture_output=True, creationflags=0x08000000)


# ---------------------------------------------------------------- icon

def make_icon(state: str) -> Image.Image:
    """64x64: a rounded 'monitor' with a glow whose colour is the health."""
    col = {"ok": (52, 211, 153), "warn": (251, 191, 36), "down": (248, 113, 113)}[state]
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for r, a in ((30, 40), (26, 70), (22, 110)):
        d.ellipse((32 - r, 32 - r, 32 + r, 32 + r), fill=(*col, a))
    d.rounded_rectangle((14, 18, 50, 42), radius=5, fill=(24, 24, 27, 255), outline=(*col, 255), width=3)
    d.rounded_rectangle((26, 44, 38, 48), radius=2, fill=(*col, 255))
    return im


class Tray:
    def __init__(self) -> None:
        self.state = "warn"
        self.mode = "?"
        self.grabber = None
        self.detail = "starting"
        self.icon = pystray.Icon("vmui", make_icon("warn"), "vmui", menu=self.menu())
        threading.Thread(target=self.poll, daemon=True).start()

    # ---- actions
    def set_mode(self, mode: str):
        def run(_icon, _item):
            ha_script({"movie": "movie_mode_on", "music": "music_mode", "off": "movie_mode_off"}[mode])
            self.mode = mode
            self.refresh()
        return run

    def toggle_grabber(self, _icon, _item):
        new = not bool(self.grabber)
        hyper_all([{"command": "componentstate", "componentstate": {"component": "SYSTEMGRABBER", "state": new}}])
        self.grabber = new
        self.refresh()

    def clear_effects(self, _icon, _item):
        hyper_all([{"command": "clear", "priority": 40}])

    def restart_stack(self, _icon, _item):
        for t in TASKS[:4]:
            subprocess.run(["taskkill", "/f", "/im", {"vmui-ambilight-hyperhdr": "hyperhdr.exe", "vmui-ambilight-openrgb": "OpenRGB.exe"}.get(t, "__none__")],
                           capture_output=True, creationflags=0x08000000)
        for t in TASKS[:4]:
            start_task(t)
            time.sleep(2)
        self.refresh()

    def open(self, url: str):
        return lambda _i, _m: webbrowser.open(url)

    def quit(self, _icon, _item):
        self.icon.stop()

    # ---- menu
    def menu(self) -> pystray.Menu:
        M, I = pystray.Menu, pystray.MenuItem
        return M(
            I(lambda _: f"vmui · {self.detail}", None, enabled=False),
            M.SEPARATOR,
            I("Movie mode", self.set_mode("movie"), checked=lambda _: self.mode == "movie", radio=True),
            I("Music mode", self.set_mode("music"), checked=lambda _: self.mode == "music", radio=True),
            I("Lights off", self.set_mode("off"), checked=lambda _: self.mode == "off", radio=True),
            M.SEPARATOR,
            I("Screen capture", self.toggle_grabber, checked=lambda _: bool(self.grabber)),
            I("Clear effects", self.clear_effects),
            M.SEPARATOR,
            I("Open mui.dragoscatalin.ro", self.open(PUBLIC), default=True),
            I("Open local /home", self.open(f"{VMUI}/home?tab=ambilight")),
            I("Wall compensation…", self.open(f"{VMUI}/home?tab=ambilight#wall")),
            I("HyperHDR settings", self.open(HYPER_UI)),
            M.SEPARATOR,
            I("Restart ambilight stack", self.restart_stack),
            I("Quit tray", self.quit),
        )

    # ---- health loop
    def refresh(self) -> None:
        info = hyper_info()
        vm = vmui_ok()
        if info is None:
            self.state, self.detail = "down", "HyperHDR unreachable"
        else:
            comps = {c["name"]: c["enabled"] for c in info.get("components", [])}
            self.grabber = comps.get("SYSTEMGRABBER")
            prio = next((p for p in info.get("priorities", []) if p.get("visible")), None)
            src = (prio or {}).get("componentId", "idle")
            missing = [t for t in TASKS[:4] if not task_running(t)]
            if missing or not vm:
                self.state = "warn"
                self.detail = ("vmui down · " if not vm else "") + (", ".join(m.replace("vmui-ambilight-", "") for m in missing) + " stopped" if missing else "")
            else:
                self.state, self.detail = "ok", f"{src.lower()} · {'capture on' if self.grabber else 'capture off'}"
        self.icon.icon = make_icon(self.state)
        self.icon.title = f"vmui — {self.detail}"
        self.icon.update_menu()

    def poll(self) -> None:
        while True:
            try:
                self.refresh()
            except Exception as e:
                log(f"refresh: {e}")
            time.sleep(15)

    def run(self) -> None:
        self.icon.run()


if __name__ == "__main__":
    try:
        Tray().run()
    except Exception as e:
        log(f"fatal: {e}")
        sys.exit(1)
