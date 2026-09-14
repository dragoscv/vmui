// 1-bit framebuffer for the 128x64 SSD1306 on the ideaspark ESP32, plus a
// BMP encoder the ESPHome `online_image` component accepts (1-bit, bottom-up).
//
// The panel is two-colour: rows 0..15 render YELLOW, rows 16..63 BLUE. Views
// use the yellow band as a title/status bar and keep body text below it.

export const W = 128;
export const H = 64;
export const YELLOW_ROWS = 16;

export class Framebuffer {
  private readonly px = new Uint8Array(W * H);

  clear(): void {
    this.px.fill(0);
  }

  set(x: number, y: number, on = true): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    this.px[y * W + x] = on ? 1 : 0;
  }

  get(x: number, y: number): boolean {
    return this.px[y * W + x] === 1;
  }

  hline(x0: number, x1: number, y: number, on = true): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, on);
  }

  vline(x: number, y0: number, y1: number, on = true): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, on);
  }

  rect(x: number, y: number, w: number, h: number, on = true): void {
    this.hline(x, x + w - 1, y, on);
    this.hline(x, x + w - 1, y + h - 1, on);
    this.vline(x, y, y + h - 1, on);
    this.vline(x + w - 1, y, y + h - 1, on);
  }

  fill(x: number, y: number, w: number, h: number, on = true): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, on);
  }

  /** Invert a region (used to draw text on the yellow band as a filled bar). */
  invert(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < H) this.px[yy * W + xx] = (this.px[yy * W + xx] ?? 0) ^ 1;
  }

  /** Draw a glyph bitmap (rows of bit strings) at x,y with integer scale. */
  blit(x: number, y: number, rows: readonly string[], scale = 1, on = true): void {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] ?? "";
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== "1") continue;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.set(x + c * scale + sx, y + r * scale + sy, on);
      }
    }
  }

  /**
   * Windows BMP, 1 bpp, palette {black, white}, rows bottom-up, 4-byte padded.
   * 128 px = 16 bytes/row, already aligned. Total 62 + 64*16 = 1086 bytes.
   */
  toBmp(): Buffer {
    const rowBytes = Math.ceil(W / 32) * 4;
    const pixelBytes = rowBytes * H;
    const headerBytes = 14 + 40 + 8;
    const buf = Buffer.alloc(headerBytes + pixelBytes);
    buf.write("BM", 0, "ascii");
    buf.writeUInt32LE(buf.length, 2);
    buf.writeUInt32LE(headerBytes, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(W, 18);
    buf.writeInt32LE(H, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(1, 28);
    buf.writeUInt32LE(0, 30);
    buf.writeUInt32LE(pixelBytes, 34);
    buf.writeInt32LE(2835, 38);
    buf.writeInt32LE(2835, 42);
    buf.writeUInt32LE(2, 46);
    buf.writeUInt32LE(2, 50);
    // palette: index 0 = black, index 1 = white (BGRA)
    buf.writeUInt32LE(0x00000000, 54);
    buf.writeUInt32LE(0x00ffffff, 58);
    for (let y = 0; y < H; y++) {
      const dstRow = headerBytes + (H - 1 - y) * rowBytes;
      for (let x = 0; x < W; x++) {
        if (this.px[y * W + x]) buf[dstRow + (x >> 3)] = (buf[dstRow + (x >> 3)] ?? 0) | (0x80 >> (x & 7));
      }
    }
    return buf;
  }

  /** Debug helper: ASCII art of the frame. */
  toAscii(): string {
    const out: string[] = [];
    for (let y = 0; y < H; y++) {
      let s = "";
      for (let x = 0; x < W; x++) s += this.px[y * W + x] ? "#" : y < YELLOW_ROWS ? "." : " ";
      out.push(s);
    }
    return out.join("\n");
  }
}
