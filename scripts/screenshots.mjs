// Usage (inside the Playwright image): node scripts/screenshots.mjs out-dir /path1 /path2 …
import { chromium, devices } from '@playwright/test';
const [out, ...paths] = process.argv.slice(2);
const browser = await chromium.launch();
for (const [name, opts] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['phone', devices['Pixel 7']]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  for (const p of paths) {
    await page.goto(`http://127.0.0.1:3100${p}`);
    await page.locator('html[data-hydrated="true"]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const file = `${out}/${p.replace(/^\//, '').replace(/\//g, '-') || 'overview'}-${name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
  await ctx.close();
}
await browser.close();
