// Screenshots for a phase pull request. Run inside the Playwright image with the dev server up:
// docker run --rm --network host -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.63.0-noble node scripts/pr-screenshots.mjs phase-2
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const BASE = 'http://127.0.0.1:3100';
const phase = process.argv[2] ?? 'phase-1';
const OUT = `docs/screenshots/${phase}`;
mkdirSync(OUT, { recursive: true });

// [file, path, { role, lang, full, phone, before }]
const shots = {
  'phase-1': [
    ['login-desktop', '/login', { role: null }],
    ['overview-desktop', '/?week=2026-06-15', { full: true }],
    ['hovership-desktop', '/hovership/week/2026-06-15'],
    ['import-waiting-desktop', '/hovership/week/2026-09-28'],
    ['payroll-list-desktop', '/payroll'],
    ['approve-dialog-desktop', '/payroll/hovership-2026-06-08', { before: async (p) => { await p.getByRole('button', { name: 'Review and approve' }).click(); await p.getByRole('dialog').waitFor(); } }],
    ['rates-desktop', '/settings/rates'],
    ['team-desktop', '/settings/team'],
    ['change-log-desktop', '/settings/audit'],
    ['hovership-dispatcher-es-desktop', '/hovership/week/2026-06-15', { role: 'dispatcher', lang: 'es' }],
    ['week-phone', '/week?week=2026-06-15', { phone: true }],
    ['hovership-phone', '/hovership/week/2026-06-15', { phone: true }],
  ],
  'phase-2': [
    ['today-desktop', '/tforce/today?date=2026-06-18', { role: 'dispatcher' }],
    ['today-phone', '/tforce/today?date=2026-06-18', { role: 'dispatcher', phone: true }],
    ['weekly-check-desktop', '/tforce/week/2026-06-15', { full: true }],
    ['weekly-assign-desktop', '/tforce/week/2026-06-15', { before: async (p) => { await p.getByRole('button', { name: 'Assign driver' }).click(); } }],
    ['exceptions-phone', '/exceptions', { role: 'dispatcher', phone: true }],
    ['extra-jobs-phone', '/extra-jobs?date=2026-06-18', { phone: true }],
    ['extra-job-form-phone', '/extra-jobs/new?date=2026-06-18', { role: 'dispatcher', phone: true }],
    ['payroll-tforce-desktop', '/payroll/tforce-2026-06-15'],
    ['overview-desktop', '/?week=2026-06-15'],
    ['weekly-check-es-desktop', '/tforce/week/2026-06-15', { role: 'finance', lang: 'es' }],
  ],
}[phase];

const browser = await chromium.launch();
for (const [file, path, o = {}] of shots) {
  const ctx = await browser.newContext(o.phone ? devices['Pixel 7'] : { viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  if (o.role !== null) await page.goto(`${BASE}/auth/dev?role=${o.role ?? 'owner'}&lang=${o.lang ?? 'en'}`);
  await page.goto(BASE + path);
  await page.locator('html[data-hydrated="true"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (o.before) await o.before(page);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: !!o.full });
  console.log(file);
  await ctx.close();
}
// Leave the dev users in English for the next test run.
const ctx = await browser.newContext();
for (const role of ['owner', 'dispatcher', 'finance', 'viewer']) await (await ctx.newPage()).goto(`${BASE}/auth/dev?role=${role}&lang=en`);
await browser.close();
