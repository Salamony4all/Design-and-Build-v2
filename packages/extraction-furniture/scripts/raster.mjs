// Dependency-free PNG rasteriser (RGB, filter 0) for vector overlays.
import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

export class Canvas {
  constructor(w, h, bg = [255, 255, 255]) {
    this.w = w; this.h = h;
    this.buf = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { this.buf[i * 3] = bg[0]; this.buf[i * 3 + 1] = bg[1]; this.buf[i * 3 + 2] = bg[2]; }
  }
  px(x, y, c, alpha = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    for (let k = 0; k < 3; k++) this.buf[o + k] = Math.round(this.buf[o + k] * (1 - alpha) + c[k] * alpha);
  }
  line(x0, y0, x1, y1, c, alpha = 1, width = 1) {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    const half = (width - 1) / 2;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + (dx * i) / steps, y = y0 + (dy * i) / steps;
      if (width <= 1) this.px(x, y, c, alpha);
      else for (let ox = -half; ox <= half; ox++) for (let oy = -half; oy <= half; oy++) this.px(x + ox, y + oy, c, alpha);
    }
  }
  rect(x0, y0, x1, y1, c, width = 1, alpha = 1) {
    this.line(x0, y0, x1, y0, c, alpha, width); this.line(x1, y0, x1, y1, c, alpha, width);
    this.line(x1, y1, x0, y1, c, alpha, width); this.line(x0, y1, x0, y0, c, alpha, width);
  }
  disc(cx, cy, r, c, alpha = 1) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) this.px(cx + x, cy + y, c, alpha);
  }
  cross(cx, cy, r, c, alpha = 1, width = 1) {
    this.line(cx - r, cy - r, cx + r, cy + r, c, alpha, width);
    this.line(cx - r, cy + r, cx + r, cy - r, c, alpha, width);
  }
  save(path) {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;
      this.buf.copy(raw, y * (this.w * 3 + 1) + 1, y * this.w * 3, (y + 1) * this.w * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
    ]);
    writeFileSync(path, png);
    return path;
  }
}

// 5x7 bitmap font (uppercase, digits, few symbols) for labels.
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'], F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'], H: ['10001', '10001', '11111', '10001', '10001', '10001', '10001'],
  I: ['111', '010', '010', '010', '010', '010', '111'], J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '11100', '10010', '10001', '10001', '10001'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'], N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], P: ['11110', '10001', '11110', '10000', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'], R: ['11110', '10001', '11110', '10100', '10010', '10001', '10001'],
  S: ['01111', '10000', '01110', '00001', '00001', '10001', '01110'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'], X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100', '00100', '00100'], Z: ['11111', '00010', '00100', '01000', '10000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], 1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'], 3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], 5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], 7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], 9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['000', '000', '000', '000', '000', '011', '011'], ',': ['000', '000', '000', '000', '011', '011', '010'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'], ':': ['00', '11', '11', '00', '11', '11', '00'],
  '(': ['001', '010', '100', '100', '100', '010', '001'], ')': ['100', '010', '001', '001', '001', '010', '100'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'], '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '#': ['01010', '11111', '01010', '01010', '11111', '01010', '00000'], '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'], '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  ' ': ['00', '00', '00', '00', '00', '00', '00'],
};
export function text(canvas, x, y, str, color = [0, 0, 0], scale = 1) {
  let cx = x;
  for (const ch of String(str).toUpperCase()) {
    const g = FONT[ch] || FONT[' '];
    for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) if (g[r][c] === '1')
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) canvas.px(cx + c * scale + sx, y + r * scale + sy, color, 1);
    cx += (g[0].length + 1) * scale;
  }
  return cx;
}
