// Génère assets/icon.png (256x256 RGBA) + assets/icon.ico (PNG embarqué).
// Lancer une seule fois : node launcher/assets/make-icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const S = 256;
const px = Buffer.alloc(S * S * 4);
const set = (x, y, r, g, b, a) => {
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
};

// fond : carré arrondi, dégradé violet -> bleu
const M = 10;
const RAD = 48;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const cx = Math.min(Math.max(x, M + RAD), S - M - RAD);
    const cy = Math.min(Math.max(y, M + RAD), S - M - RAD);
    const inside =
      x >= M && x < S - M && y >= M && y < S - M &&
      Math.hypot(x - cx, y - cy) <= RAD;
    if (!inside) { set(x, y, 0, 0, 0, 0); continue; }
    const t = (x + y) / (2 * S);
    set(x, y, Math.round(84 + t * 46), Math.round(58 + t * 22), Math.round(200 + t * 42), 255);
  }
}

// "Y" blanc
const disc = (x, y, rr) => {
  for (let dx = -rr; dx <= rr; dx++)
    for (let dy = -rr; dy <= rr; dy++) {
      const px2 = Math.round(x + dx);
      const py2 = Math.round(y + dy);
      if (dx * dx + dy * dy <= rr * rr && px2 >= 0 && px2 < S && py2 >= 0 && py2 < S)
        set(px2, py2, 255, 255, 255, 255);
    }
};
for (let i = 0; i <= 120; i++) { const p = i / 120; disc(70 + p * 58, 62 + p * 66, 11); }
for (let i = 0; i <= 120; i++) { const p = i / 120; disc(186 - p * 58, 62 + p * 66, 11); }
for (let i = 0; i <= 120; i++) { const p = i / 120; disc(128, 128 + p * 66, 11); }

// --- encodage PNG ---
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(join(dir, 'icon.png'), png);

// --- ICO qui embarque le PNG (valide sous Windows Vista+) ---
const entry = Buffer.alloc(16);
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12); // offset
const head = Buffer.alloc(6);
head.writeUInt16LE(1, 2); // type icon
head.writeUInt16LE(1, 4); // 1 image
writeFileSync(join(dir, 'icon.ico'), Buffer.concat([head, entry, png]));

console.log('OK -> assets/icon.png (' + png.length + ' o) + assets/icon.ico');
