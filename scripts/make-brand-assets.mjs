// Crops the brand PNGs in design/brand/source to their content and writes the web sizes to public/brand.
// Run inside the Playwright image (it uses the browser canvas, so the host needs no image tools):
// docker run --rm -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.63.0-noble node scripts/make-brand-assets.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SRC = 'design/brand/source';
const OUT = 'public/brand';
// [source, output, target width (null = native), padding (share of the longest side), background, square]
const jobs = [
  ['Frame 1.png', 'aarisa-logo.png', null, 0.02, null, false],
  ['Frame 3.png', 'aarisa-logo-stacked.png', null, 0.03, null, false],
  ['Frame 2.png', 'aarisa-mark.png', null, 0.04, null, false],
  ['Frame 2.png', 'favicon-32.png', 32, 0.04, null, true],
  ['Frame 2.png', 'favicon-48.png', 48, 0.04, null, true],
  ['Frame 2.png', 'apple-touch-icon.png', 180, 0.16, '#FFFFFF', true],
  ['Frame 2.png', 'icon-192.png', 192, 0.16, '#FFFFFF', true],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, out, width, pad, bg, square] of jobs) {
  const src = 'data:image/png;base64,' + readFileSync(`${SRC}/${file}`).toString('base64');
  const dataUrl = await page.evaluate(async ({ src, width, pad, bg, square }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let i = 0; i < d.length; i += 4) {
      const white = d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240;
      if (d[i + 3] > 20 && !white) {
        const px = (i / 4) % c.width, py = Math.floor(i / 4 / c.width);
        minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const p = Math.round(Math.max(w, h) * pad);
    let cw = w + 2 * p, ch = h + 2 * p;
    if (square) cw = ch = Math.max(cw, ch);
    const scale = width ? width / cw : 1;
    const o = document.createElement('canvas');
    o.width = Math.round(cw * scale);
    o.height = Math.round(ch * scale);
    const ox = o.getContext('2d');
    ox.imageSmoothingQuality = 'high';
    if (bg) { ox.fillStyle = bg; ox.fillRect(0, 0, o.width, o.height); }
    ox.drawImage(c, minX, minY, w, h, ((cw - w) / 2) * scale, ((ch - h) / 2) * scale, w * scale, h * scale);
    return o.toDataURL('image/png');
  }, { src, width, pad, bg, square });
  writeFileSync(`${OUT}/${out}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(out);
}
await browser.close();
