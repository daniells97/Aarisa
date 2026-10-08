// Usage (inside the Playwright image): ROLE=owner node scripts/screenshots.mjs out-dir /path1 /path2 …
// Signs in with the development login first (DEV_LOGIN=1 on the dev server).
import { chromium, devices } from '@playwright/test';
const [out, ...paths] = process.argv.slice(2);
const browser = await chromium.launch();
for (const [name, opts] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['phone', devices['Pixel 7']]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:3100/auth/dev?role=${process.env.ROLE ?? 'owner'}&lang=${process.env.LANG_UI ?? 'en'}`);
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
