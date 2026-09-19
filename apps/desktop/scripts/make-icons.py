"""Generate app + tray icons. Tray icons carry health as a coloured glow
(ok / warn / down), same design language as the old ambilight/tray.py."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
COL = {"ok": (52, 211, 153), "warn": (251, 191, 36), "down": (248, 113, 113), "app": (124, 156, 255)}


def draw(size: int, col: tuple[int, int, int]) -> Image.Image:
    s = size / 64
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for r, a in ((30, 40), (26, 70), (22, 110)):
        d.ellipse((32 * s - r * s, 32 * s - r * s, 32 * s + r * s, 32 * s + r * s), fill=(*col, a))
    d.rounded_rectangle((14 * s, 18 * s, 50 * s, 42 * s), radius=5 * s, fill=(24, 24, 27, 255), outline=(*col, 255), width=max(1, round(3 * s)))
    d.rounded_rectangle((26 * s, 44 * s, 38 * s, 48 * s), radius=2 * s, fill=(*col, 255))
    return im


for state, col in COL.items():
    name = "icon" if state == "app" else f"tray-{state}"
    draw(32, col).save(OUT / f"{name}-32.png")
    if state == "app":
        big = draw(512, col)
        big.save(OUT / "icon.png")
        big.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        draw(128, col).save(OUT / "128x128.png")
        draw(256, col).save(OUT / "128x128@2x.png")
        draw(32, col).save(OUT / "32x32.png")
print("icons ->", OUT)
