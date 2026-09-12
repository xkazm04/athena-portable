#!/usr/bin/env node
/**
 * Draw the app-icon source, `src-tauri/icons/app-icon.png` (1024x1024 RGBA).
 *
 *   node scripts/make-icon.mjs
 *   pnpm tauri icon src-tauri/icons/app-icon.png
 *
 * The mark is the window this app is: a dark rounded square, a thin accent bar across the top
 * where the module bar goes, and the module area under it. Geometry rather than a binary blob, so
 * it can be changed by editing numbers and re-running, and so the repository carries the drawing
 * as well as the drawn. No image dependency: a PNG is a zlib stream of filtered scanlines, and
 * Node has zlib.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 1024;
const SS = 2; // supersampling factor, which is the whole of the antialiasing
const RADIUS = 184;

const INK_TOP = [16, 26, 34];
const INK_BOTTOM = [8, 14, 20];
const ACCENT = [34, 211, 238];
const AREA = [30, 44, 56];

// In 1024-space, and in the same proportion as the real window: a 36px bar over an 864px body.
const FRAME = 176; // the inset of the drawn window inside the square
const BAR_TOP = 300;
const BAR_H = 88;
const GAP = 28;

const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x < x1 && y >= y0 && y < y1;

/** Inside the rounded square? Coordinates are in 1024-space. */
function insideRounded(x, y) {
  const cx = Math.min(Math.max(x, RADIUS), SIZE - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), SIZE - RADIUS);
  return Math.hypot(x - cx, y - cy) <= RADIUS;
}

function render() {
  const acc = new Float64Array(SIZE * SIZE * 4);
  const W = SIZE * SS;
  for (let sy = 0; sy < W; sy += 1) {
    const y = (sy + 0.5) / SS;
    for (let sx = 0; sx < W; sx += 1) {
      const x = (sx + 0.5) / SS;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (insideRounded(x, y)) {
        const t = y / SIZE;
        r = INK_TOP[0] + (INK_BOTTOM[0] - INK_TOP[0]) * t;
        g = INK_TOP[1] + (INK_BOTTOM[1] - INK_TOP[1]) * t;
        b = INK_TOP[2] + (INK_BOTTOM[2] - INK_TOP[2]) * t;
        a = 255;
        if (inRect(x, y, FRAME, BAR_TOP, SIZE - FRAME, BAR_TOP + BAR_H)) {
          [r, g, b] = ACCENT;
        } else if (inRect(x, y, FRAME, BAR_TOP + BAR_H + GAP, SIZE - FRAME, SIZE - FRAME)) {
          [r, g, b] = AREA;
        }
      }
      const i = (Math.floor(sy / SS) * SIZE + Math.floor(sx / SS)) * 4;
      acc[i] += r;
      acc[i + 1] += g;
      acc[i + 2] += b;
      acc[i + 3] += a;
    }
  }

  const samples = SS * SS;
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1)); // one filter byte (0 = None) per scanline
  for (let y = 0; y < SIZE; y += 1) {
    const rowStart = y * (SIZE * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < SIZE; x += 1) {
      const src = (y * SIZE + x) * 4;
      const dst = rowStart + 1 + x * 4;
      for (let c = 0; c < 4; c += 1) raw[dst + c] = Math.round(acc[src + c] / samples);
    }
  }
  return raw;
}

// --- PNG container ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(appDir, "src-tauri", "icons", "app-icon.png");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, png(render()));
console.log(`wrote ${path.relative(appDir, out).replace(/\\/g, "/")} (${SIZE}x${SIZE})`);
console.log("next: pnpm tauri icon src-tauri/icons/app-icon.png");
