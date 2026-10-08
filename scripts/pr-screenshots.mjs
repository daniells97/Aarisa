// Screenshots for the Phase 1 pull request. Run inside the Playwright image with the dev server up:
// docker run --rm --network host -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.63.0-noble node scripts/pr-screenshots.mjs
import { chromium, devices } from '@playwright/test';

const BASE = 'http://127.0.0.1:3100';
const OUT = 'docs/screenshots/phase-1';
const browser = await chromium.launch();

async function shoot(page, path, file, { full = true, before } = {}) {
  await page.goto(BASE + path);
  await page.locator('html[data-hydrated="true"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (before) await before(page);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: full });
  console.log(file);
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 } });
let page = await desktop.newPage();
await shoot(page, '/login', 'login-desktop', { full: false });
await page.goto(`${BASE}/auth/dev?role=owner&lang=en`);
await shoot(page, '/?week=2026-06-15', 'overview-desktop');
await shoot(page, '/hovership/week/2026-06-15', 'hovership-desktop', { full: false });
await shoot(page, '/hovership/week/2026-09-28', 'import-waiting-desktop', { full: false });
await shoot(page, '/payroll', 'payroll-list-desktop', { full: false });
await shoot(page, '/payroll/hovership-2026-06-08', 'approve-dialog-desktop', {
  full: false,
  before: async (p) => { await p.getByRole('button', { name: 'Review and approve' }).click(); await p.getByRole('dialog').waitFor(); },
});
await shoot(page, '/settings/rates', 'rates-desktop', { full: false });
await shoot(page, '/settings/team', 'team-desktop', { full: false });
await shoot(page, '/settings/audit', 'change-log-desktop', { full: false });
await page.goto(`${BASE}/auth/dev?role=dispatcher&lang=es`);
await shoot(page, '/hovership/week/2026-06-15', 'hovership-dispatcher-es-desktop', { full: false });
await desktop.close();

const phone = await browser.newContext({ ...devices['Pixel 7'] });
page = await phone.newPage();
await page.goto(`${BASE}/auth/dev?role=owner&lang=en`);
await shoot(page, '/week?week=2026-06-15', 'week-phone', { full: false });
await shoot(page, '/hovership/week/2026-06-15', 'hovership-phone', { full: false });
await phone.close();
await browser.close();
