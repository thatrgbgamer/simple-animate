/**
 * Regenerates the application icons in build/ from one vector definition.
 *
 * Optional tooling step — the generated icon.png / icon.ico / icon.icns are
 * committed, so a normal build never needs this. Run it only when the artwork
 * changes:
 *
 *   npm i -D playwright && node scripts/make-icons.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');

const ICON_HTML = `
<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; width: 1024px; height: 1024px; background: transparent; }
  .icon {
    position: absolute; inset: 0; border-radius: 232px;
    background: conic-gradient(from 210deg, #FF4D6D, #FFB347, #38D39F, #5B8CFF, #B56BFF, #FF4D6D);
  }
  .inner {
    position: absolute; inset: 58px; border-radius: 184px;
    background: radial-gradient(circle at 50% 18%, #1E2430 0%, #0E1017 78%);
  }
  .ball { position: absolute; border-radius: 50%; background: #FFFFFF; }
  .b1 { width: 168px; height: 168px; left: 186px; top: 570px; opacity: 0.30; }
  .b2 { width: 208px; height: 208px; left: 402px; top: 386px; opacity: 0.58; }
  .b3 { width: 250px; height: 250px; left: 628px; top: 178px; opacity: 1; }
  .floor { position: absolute; left: 186px; right: 150px; top: 806px; height: 12px; border-radius: 6px; background: rgba(255,255,255,0.16); }
</style>
<div class="icon"><div class="inner">
  <div class="ball b1"></div><div class="ball b2"></div><div class="ball b3"></div>
  <div class="floor"></div>
</div></div>`;

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

async function render() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(ICON_HTML);

  const images = new Map();
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.addStyleTag({ content: `html, body { width:${size}px; height:${size}px; zoom:${size / 1024}; }` });
    images.set(size, await page.screenshot({ omitBackground: true }));
  }
  await browser.close();
  return images;
}

/** ICO container holding PNG entries (Vista and newer). */
function packIco(images, sizes) {
  const entries = sizes.map((size) => ({ size, png: images.get(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const directory = [];
  for (const entry of entries) {
    const row = Buffer.alloc(16);
    row.writeUInt8(entry.size >= 256 ? 0 : entry.size, 0);
    row.writeUInt8(entry.size >= 256 ? 0 : entry.size, 1);
    row.writeUInt8(0, 2);
    row.writeUInt8(0, 3);
    row.writeUInt16LE(1, 4);
    row.writeUInt16LE(32, 6);
    row.writeUInt32LE(entry.png.length, 8);
    row.writeUInt32LE(offset, 12);
    offset += entry.png.length;
    directory.push(row);
  }
  return Buffer.concat([header, ...directory, ...entries.map((entry) => entry.png)]);
}

/** ICNS container holding PNG entries. */
function packIcns(images) {
  const types = [
    ['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64],
    ['ic07', 128], ['ic08', 256], ['ic13', 256], ['ic09', 512], ['ic14', 512], ['ic10', 1024]
  ];
  const chunks = types.map(([type, size]) => {
    const png = images.get(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

const images = await render();
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'icon.png'), images.get(1024));
fs.writeFileSync(path.join(buildDir, 'icon.ico'), packIco(images, [16, 24, 32, 48, 64, 128, 256]));
fs.writeFileSync(path.join(buildDir, 'icon.icns'), packIcns(images));
console.log('Wrote build/icon.png, build/icon.ico and build/icon.icns');
