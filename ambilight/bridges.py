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

import deskbar_bridge  # noqa: E402
import dxlight_bridge  # noqa: E402
import openrgb_bridge  # noqa: E402

# (name, port, factory, run) -- factory opens the device, run blocks forever.
BRIDGES = (
    ("dxlight", 19446, lambda: dxlight_bridge.DxLight(255), dxlight_bridge.run_listen),
    ("pcglow", 19447, openrgb_bridge.PcGlow, openrgb_bridge.run_listen),
    ("deskbar", 19448, deskbar_bridge.DeskBar, deskbar_bridge.run_listen),
)

RETRY_S = 15


def _supervise(name: str, port: int, factory, run) -> None:
    while True:
        dev = None
        try:
            dev = factory()
            if hasattr(dev, "describe"):
                dev.describe()
            print(f"[{name}] up on udp/{port}", flush=True)
            run(dev, port)
        except Exception:  # noqa: BLE001 -- keep the other bridge alive whatever this one throws
            print(f"[{name}] died:\n{traceback.format_exc()}", flush=True)
        finally:
            close = getattr(dev, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:  # noqa: BLE001
                    pass
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
