/**
 * Renders the app icons from the shield-and-keyhole mark.
 *
 * The build environment has no image toolchain, so this writes PNGs directly:
 * an RGBA raster, deflated, wrapped in IHDR/IDAT/IEND chunks. Shapes are
 * evaluated analytically with 3x3 supersampling for antialiasing.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const mixColor = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Shield outline in normalised coordinates, `scale` shrinks it around the centre. */
function inShield(x, y, scale) {
  const nx = (x - 0.5) / scale + 0.5;
  const ny = (y - 0.5) / scale + 0.5;
  const top = 0.07;
  const bottom = 0.95;
  if (ny < top || ny > bottom) return false;

  const t = (ny - top) / (bottom - top);
  let halfWidth = t < 0.52 ? 0.37 - 0.03 * t : 0.355 * Math.sqrt(Math.max(0, 1 - ((t - 0.52) / 0.48) ** 2));
  if (t < 0.07) halfWidth *= Math.sqrt(Math.max(0, 1 - ((0.07 - t) / 0.07) ** 2));
  return Math.abs(nx - 0.5) <= halfWidth;
}

/** Keyhole: a circle over a tapering stem. */
function inKeyhole(x, y, scale) {
  const nx = (x - 0.5) / scale + 0.5;
  const ny = (y - 0.5) / scale + 0.5;
  const circle = (nx - 0.5) ** 2 + (ny - 0.42) ** 2 <= 0.115 ** 2;
  const stemTop = 0.45;
  const stemBottom = 0.72;
  const stem =
    ny >= stemTop &&
    ny <= stemBottom &&
    Math.abs(nx - 0.5) <= lerp(0.075, 0.035, (ny - stemTop) / (stemBottom - stemTop));
  return circle || stem;
}

const TOP_COLOR = [122, 162, 255];
const BOTTOM_COLOR = [70, 97, 214];
const CANVAS_COLOR = [10, 13, 20];

function render(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.62 : 0.94;
  const samples = 3;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let shield = 0;
      let keyhole = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          if (inShield(x, y, scale)) shield += 1;
          if (inKeyhole(x, y, scale)) keyhole += 1;
        }
      }
      const total = samples * samples;
      const shieldAlpha = shield / total;
      const keyholeAlpha = keyhole / total;

      const gradient = mixColor(TOP_COLOR, BOTTOM_COLOR, (px / size) * 0.35 + (py / size) * 0.65);
      const shieldColor = mixColor(gradient, CANVAS_COLOR, Math.min(1, keyholeAlpha));

      const base = maskable ? CANVAS_COLOR : [0, 0, 0];
      const baseAlpha = maskable ? 1 : 0;
      const alpha = baseAlpha + (1 - baseAlpha) * shieldAlpha;
      const color = alpha === 0 ? base : mixColor(base, shieldColor, shieldAlpha / alpha);

      const offset = (py * size + px) * 4;
      rgba[offset] = Math.round(color[0]);
      rgba[offset + 1] = Math.round(color[1]);
      rgba[offset + 2] = Math.round(color[2]);
      rgba[offset + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

const targets = [
  ['public/icons/icon-192.png', 192, { maskable: false }],
  ['public/icons/icon-512.png', 512, { maskable: false }],
  ['public/icons/icon-maskable-512.png', 512, { maskable: true }],
  ['public/icons/apple-touch-icon.png', 180, { maskable: true }],
];

for (const [path, size, options] of targets) {
  const file = resolve(ROOT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(size, options));
  console.log(`wrote ${path} (${size}x${size})`);
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="5" y1="2.5" x2="27" y2="30" gradientUnits="userSpaceOnUse">
      <stop stop-color="#7aa2ff"/><stop offset="1" stop-color="#4661d6"/>
    </linearGradient>
  </defs>
  <path d="M16 2.5 5 7v10.2C5 24 10.2 28.4 16 30c5.8-1.6 11-6 11-12.8V7z" fill="url(#g)"/>
  <circle cx="16" cy="14" r="3.2" fill="#0a0d14"/>
  <path d="M16 16.6v5" stroke="#0a0d14" stroke-width="2.4" stroke-linecap="round"/>
</svg>
`;
writeFileSync(resolve(ROOT, 'public/favicon.svg'), favicon);
console.log('wrote public/favicon.svg');
