import { describe, expect, it } from "vitest";
import { Framebuffer, H, W } from "@/lib/esp/framebuffer";
import { fit, text, textWidth, wrap } from "@/lib/esp/font";

describe("esp framebuffer", () => {
  it("encodes a 1-bit bottom-up BMP of exactly 1086 bytes", () => {
    const fb = new Framebuffer();
    fb.set(0, 0);
    fb.set(127, 63);
    const bmp = fb.toBmp();
    expect(bmp.length).toBe(62 + 16 * 64);
    expect(bmp.toString("ascii", 0, 2)).toBe("BM");
    expect(bmp.readInt32LE(18)).toBe(W);
    expect(bmp.readInt32LE(22)).toBe(H);
    expect(bmp.readUInt16LE(28)).toBe(1);
    // top-left pixel lives in the LAST row of the pixel array (bottom-up)
    expect(bmp[62 + 63 * 16]! & 0x80).toBe(0x80);
    // bottom-right pixel is the first row's last byte, LSB
    expect(bmp[62 + 15]! & 0x01).toBe(0x01);
  });

  it("draws text inside bounds and folds diacritics", () => {
    const fb = new Framebuffer();
    const end = text(fb, 0, 20, "Ștefan ține", 1);
    expect(end).toBe(textWidth("Stefan tine", 1));
    let lit = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fb.get(x, y)) lit++;
    expect(lit).toBeGreaterThan(40);
  });

  it("fits and wraps to the panel width", () => {
    expect(fit("a very long shopping list entry", 60).length).toBeLessThanOrEqual(10);
    const lines = wrap("lorem ipsum dolor sit amet consectetur adipiscing elit sed do", 126, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(126);
  });
});
