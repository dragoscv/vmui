"""Photo backgrounds for the desk screen.

Sources: a local folder (jpg/png/webp) and the online pool the vmui API
already fetched (APOD / Met / Art Institute / Commons — dashy's vetted
free sources). Downloads are cached under .copilot-tmp/turzx/bg/ already
resized + cropped to 480x320, so switching a background is one disk read.
Downloading happens on a worker thread; `pick()` never blocks the renderer.
"""

from __future__ import annotations

import hashlib
import io
import random
import threading
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

W, H = 480, 320
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


class Backgrounds:
    def __init__(self, cache_dir: Path) -> None:
        self.dir = cache_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.online: list[dict] = []  # {url,title,credit,source}
        self.ready: dict[str, Path] = {}  # url -> cached file
        self.failed: set[str] = set()
        self.folder_files: list[Path] = []
        self.folder: str = ""
        self.folder_scanned = 0.0
        self._worker = threading.Thread(target=self._loop, daemon=True)
        self._worker.start()

    # ---- inputs from the poller
    def set_online(self, photos: list[dict]) -> None:
        with self.lock:
            self.online = [p for p in photos if isinstance(p, dict) and p.get("url")]

    def set_folder(self, folder: str) -> None:
        if folder != self.folder:
            self.folder, self.folder_scanned = folder, 0.0

    # ---- worker: prefetch a handful of online photos
    def _loop(self) -> None:
        while True:
            try:
                self._scan_folder()
            except Exception:
                pass
            with self.lock:
                todo = [p for p in self.online if p["url"] not in self.ready and p["url"] not in self.failed][:6]
            for p in todo:
                path = self.dir / (hashlib.sha1(p["url"].encode()).hexdigest()[:16] + ".jpg")
                if not path.exists():
                    try:
                        with urllib.request.urlopen(urllib.request.Request(p["url"], headers={"User-Agent": "vmui-turzx/1.0"}), timeout=20) as r:
                            im = Image.open(io.BytesIO(r.read())).convert("RGB")
                        ImageOps.fit(im, (W, H), Image.LANCZOS, centering=(0.5, 0.4)).save(path, "JPEG", quality=88)
                    except Exception:
                        with self.lock:
                            self.failed.add(p["url"])
                        continue
                with self.lock:
                    self.ready[p["url"]] = path
            time.sleep(5)

    def _scan_folder(self) -> None:
        if not self.folder or time.time() - self.folder_scanned < 300:
            return
        self.folder_scanned = time.time()
        root = Path(self.folder)
        files: list[Path] = []
        if root.is_dir():
            for p in root.rglob("*"):
                if p.suffix.lower() in EXTS and p.is_file():
                    files.append(p)
                if len(files) >= 2000:
                    break
        with self.lock:
            self.folder_files = files

    # ---- picking
    def pick(self, sources: list[str], exclude: str | None = None) -> tuple[Image.Image, dict] | None:
        """One random ready background from the enabled sources. Returns
        (image 480x320, meta{title,credit,source,key}) or None if nothing is ready yet."""
        cands: list[tuple[str, dict]] = []
        online = [s for s in sources if s != "folder"]
        with self.lock:
            if "folder" in sources:
                for f in self.folder_files:
                    cands.append((str(f), {"title": f.stem.replace("_", " ").replace("-", " "), "credit": "", "source": "folder", "key": str(f)}))
            for p in self.online:
                if p.get("source") in online and p["url"] in self.ready:
                    cands.append((str(self.ready[p["url"]]), {"title": p.get("title") or "", "credit": p.get("credit") or "", "source": p["source"], "key": p["url"]}))
        cands = [c for c in cands if c[1]["key"] != exclude] or cands
        if not cands:
            return None
        path, meta = random.choice(cands)
        try:
            im = Image.open(path).convert("RGB")
            if im.size != (W, H):
                im = ImageOps.fit(im, (W, H), Image.LANCZOS, centering=(0.5, 0.4))
            return im, meta
        except Exception:
            return None
