import { expect, signInAs, test } from './fixtures';

// No screen may scroll sideways, from a small phone to a 2560 px monitor. Wide tables scroll inside their panel.
const paths = ['/?week=2026-06-15', '/tforce/today?date=2026-06-18', '/tforce/week/2026-06-15', '/hovership/week/2026-06-15',
  '/payroll/hovership-2026-06-08', '/settlements', '/settings/rates', '/settings/team', '/settings/audit'];

for (const width of [360, 1024, 2560]) {
  test(`no sideways scrolling at ${width}px`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'sets its own viewport');
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await signInAs(page, 'owner');
    for (const path of paths) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(scroll, `${path} at ${width}px`).toBeLessThanOrEqual(client + 1);
    }
  });
}
