import { expect, signInAs, test } from './fixtures';

// Rule 9: roles are enforced on the server. These go straight to server endpoints, not through the UI.
test.describe('server-side permissions', () => {
  test.skip(({ isMobile }) => isMobile, 'same server for every device');

  test('payroll file: 401 signed out, 403 for dispatchers, CSV for finance', async ({ page, request }) => {
    expect((await request.get('/payroll-export/hovership-2026-06-08', { maxRedirects: 0 })).status()).toBe(401);
    await signInAs(page, 'dispatcher');
    expect((await page.request.get('/payroll-export/hovership-2026-06-08')).status()).toBe(403);
    await signInAs(page, 'finance');
    const res = await page.request.get('/payroll-export/hovership-2026-06-08');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    expect(await res.text()).toContain('13389.00');
  });

  test('a dispatcher cannot open owner-only or money pages', async ({ page }) => {
    await signInAs(page, 'dispatcher');
    for (const path of ['/settings/team', '/settings/audit']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible();
    }
  });

  test('the development sign-in is refused for unknown roles', async ({ request }) => {
    expect((await request.get('/auth/dev?role=admin', { maxRedirects: 0 })).status()).toBe(404);
  });
});
