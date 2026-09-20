import { fit, text, textScroll, textWidth, wrap } from "@/lib/esp/font";
import { Framebuffer, H, W } from "@/lib/esp/framebuffer";
import { describe, expect, it } from "vitest";

function litColumns(fb: Framebuffer, y0: number, y1: number): number[] {
  const cols: number[] = [];
  for (let x = 0; x < W; x++) for (let y = y0; y <= y1; y++) if (fb.get(x, y)) { cols.push(x); break; }
  return cols;
}

describe("esp textScroll", () => {
  it("draws short text exactly like text()", () => {
    const a = new Framebuffer(); const b = new Framebuffer();
    text(a, 10, 20, "salut");
    textScroll(b, 10, 20, 100, "salut", 123456);
    expect(b.toAscii()).toBe(a.toAscii());
  });
  it("never lights a pixel outside the clip window and moves over time", () => {
    const long = "aceasta este o linie mult prea lunga pentru ecran";
    expect(textWidth(long)).toBeGreaterThan(90);
    const f0 = new Framebuffer(); textScroll(f0, 34, 20, 90, long, 0);
    const c0 = litColumns(f0, 20, 27);
    expect(Math.min(...c0)).toBeGreaterThanOrEqual(34);
    expect(Math.max(...c0)).toBeLessThan(34 + 90);
    const f1 = new Framebuffer(); textScroll(f1, 34, 20, 90, long, 3000);
    expect(f1.toAscii()).not.toBe(f0.toAscii());
    const c1 = litColumns(f1, 20, 27);
    expect(Math.min(...c1)).toBeGreaterThanOrEqual(34);
    expect(Math.max(...c1)).toBeLessThan(34 + 90);
    // fully scrolled: the tail is visible, start is not
    const f2 = new Framebuffer(); textScroll(f2, 34, 20, 90, long, 1500 + 60_000);
    expect(litColumns(f2, 20, 27).length).toBeGreaterThan(0);
  });
});

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
