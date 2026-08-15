#!/usr/bin/env node
/**
 * Generates images/icon.png (128x128) for the extension — no dependencies.
 * "PB" rendered from a 5x7 bitmap font on a two-tone rounded square.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const BG = [0x17, 0x3a, 0x5e, 255]; // deep navy
const BG2 = [0x1f, 0x4d, 0x7a, 255]; // lighter navy (diagonal accent)
const FG = [0xf5, 0xa6, 0x23, 255]; // amber

const GLYPHS = {
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110']
};

const px = new Uint8Array(SIZE * SIZE * 4);
const radius = 22;

function inRoundedSquare(x, y) {
  const r = radius;
  const cx = x < r ? r : x >= SIZE - r ? SIZE - r - 1 : x;
  const cy = y < r ? r : y >= SIZE - r ? SIZE - r - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= r && x < SIZE - r) || (y >= r && y < SIZE - r);
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    if (!inRoundedSquare(x, y)) {
      px.set([0, 0, 0, 0], i);
      continue;
    }
    px.set(x + y > SIZE ? BG2 : BG, i);
  }
}

// Render "PB": scale 6 => glyph 30x42, gap 8; total 68 wide, centered.
const scale = 6;
const totalW = 5 * scale * 2 + 8;
const startX = Math.round((SIZE - totalW) / 2);
const startY = Math.round((SIZE - 7 * scale) / 2);
['P', 'B'].forEach((ch, gi) => {
  const rows = GLYPHS[ch];
  const gx = startX + gi * (5 * scale + 8);
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 5; c++) {
      if (rows[r][c] !== '1') continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = gx + c * scale + dx;
          const y = startY + r * scale + dy;
          px.set(FG, (y * SIZE + x) * 4);
        }
      }
    }
  }
});

// --- minimal PNG encoder (RGBA, no filter) ---
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(__dirname, '..', 'images', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
