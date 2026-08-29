/**
 * Renders the PWA icons from the eQuantic mark in `src/assets/brand/`.
 *
 * The previous version drew a shield analytically because there was no image
 * toolchain here. There is now a real brand file, and re-tracing its curves by
 * hand would guarantee the icons drift from the logo the moment the brand is
 * touched — so the SVG is rasterised in the browser Playwright already provides
 * for the smoke test, and stays the single source of truth.
 *
 *   npm run icons
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = resolve(ROOT, 'src/assets/brand');
const OUT = resolve(ROOT, 'public/icons');

/** The app's dark canvas: the tile matches the product it opens. */
const BACKGROUND = '#0a0d14';

const TARGETS = [
  // `inset` is the share of the tile left empty around the mark. Maskable icons
  // need a wide margin because the platform may crop them to a circle.
  { file: 'icon-192.png', size: 192, inset: 0.18 },
  { file: 'icon-512.png', size: 512, inset: 0.18 },
  { file: 'icon-maskable-512.png', size: 512, inset: 0.3 },
  { file: 'apple-touch-icon.png', size: 180, inset: 0.18 },
];

const symbol = readFileSync(resolve(BRAND, 'logo-white-symbol.svg'), 'utf8');

const page = (size, inset) => `<!doctype html><style>
  html,body{margin:0;padding:0}
  body{width:${size}px;height:${size}px;background:${BACKGROUND};display:flex;align-items:center;justify-content:center}
  svg{width:${Math.round(size * (1 - inset * 2))}px;height:auto;display:block}
</style>${symbol}`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

for (const { file, size, inset } of TARGETS) {
  const tab = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await tab.setContent(page(size, inset));
  const png = await tab.screenshot({ omitBackground: false });
  writeFileSync(resolve(OUT, file), png);
  await tab.close();
  console.log(`${file.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

await browser.close();
