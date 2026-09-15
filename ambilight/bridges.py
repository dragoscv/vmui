"""Run every HyperHDR bridge in ONE pythonw process.

Replaces the separate `vmui-ambilight-dxlight` (udp 19446 -> DX Light HID)
and `vmui-ambilight-pcglow` (udp 19447 -> OpenRGB SDK) scheduled tasks. Each
bridge keeps its own module and CLI (`--test`, `--list`) for diagnostics; this
file only hosts their `run_listen` loops as threads and restarts one that
dies, so a missing HID device or a restarting OpenRGB never takes the other
strip down with it.

  pythonw bridges.py            # both bridges, ports from BRIDGES below
"""
from __future__ import annotations

import os
import sys
import threading
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

if sys.stdout is None:  # pythonw: no console, keep the prints somewhere readable.
    # Must run BEFORE importing the bridge modules: each of them redirects
    # stdout to its own log when it sees None, which would split the output.
    _log = os.path.join(os.path.dirname(HERE), ".copilot-tmp", "service-logs")
    os.makedirs(_log, exist_ok=True)
    sys.stdout = sys.stderr = open(os.path.join(_log, "bridges.log"), "a", buffering=1, encoding="utf-8")

import a51_lux  # noqa: E402
import deskbar_bridge  # noqa: E402
import dxlight_bridge  # noqa: E402
import halamps_bridge  # noqa: E402
import openrgb_bridge  # noqa: E402
import video_follow  # noqa: E402

# (name, port, factory, run) -- factory opens the device, run blocks forever.
BRIDGES = (
    ("dxlight", 19446, lambda: dxlight_bridge.DxLight(255), dxlight_bridge.run_listen),
    ("pcglow", 19447, openrgb_bridge.PcGlow, openrgb_bridge.run_listen),
    ("deskbar", 19448, deskbar_bridge.DeskBar, deskbar_bridge.run_listen),
    ("halamps", 19449, halamps_bridge.HaLamps, halamps_bridge.run_listen),
    ("a51lux", 0, a51_lux.A51Lux, a51_lux.run_listen),  # no UDP; polls adb -> HA sensor.a51_light
    ("videofollow", 0, video_follow.VideoFollow, video_follow.run_listen),  # no UDP; window -> HyperHDR crop + movie mode
)

RETRY_S = 15
# After this many consecutive deaths of one bridge, run its recovery hook
# (dxlight: scripts/dxlight-recover.ps1 -- observe PnP state, reopen, then
# disable/enable the HID child through the elevated task). The hook runs
# once per streak; if it does not help we are back to 15 s retries with the
# state written down for the next hand-replug.
RECOVER_AFTER = 3
RECOVER = {
    "dxlight": ["pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                os.path.join(os.path.dirname(HERE), "scripts", "dxlight-recover.ps1")],
}


def _supervise(name: str, port: int, factory, run) -> None:
    import subprocess  # noqa: PLC0415

    streak = 0
    while True:
        dev = None
        try:
            dev = factory()
            if hasattr(dev, "describe"):
                dev.describe()
            print(f"[{name}] up on udp/{port}", flush=True)
            streak = 0
            run(dev, port)
        except Exception:  # noqa: BLE001 -- keep the other bridge alive whatever this one throws
            print(f"[{name}] died:\n{traceback.format_exc()}", flush=True)
            streak += 1
        finally:
            close = getattr(dev, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:  # noqa: BLE001
                    pass
        if streak == RECOVER_AFTER and name in RECOVER:
            print(f"[{name}] {streak} deaths in a row -> recovery hook", flush=True)
            try:
                r = subprocess.run(RECOVER[name], capture_output=True, text=True, timeout=120,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                for line in (r.stdout + r.stderr).splitlines():
                    print(f"  {line}", flush=True)
                print(f"[{name}] recovery exit {r.returncode}", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"[{name}] recovery hook failed: {e}", flush=True)
        print(f"[{name}] retry in {RETRY_S}s", flush=True)
        time.sleep(RETRY_S)


def main() -> int:
    threads = [
        threading.Thread(target=_supervise, args=b, name=b[0], daemon=True) for b in BRIDGES
    ]
    for t in threads:
        t.start()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
