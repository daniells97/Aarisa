import { expect, signInAs, test } from './fixtures';

test.describe('change log', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop screen');

  test('finance sees who changed what; a bonus edit appears at the top', async ({ page }) => {
    await signInAs(page, 'finance', '/hovership/week/2026-06-15');
    await page.getByRole('button', { name: 'Show days for Leonardo Vicentini' }).click();
    const input = page.getByRole('textbox', { name: /Bonus for Leonardo Vicentini/ }).first();
    const before = await input.inputValue();
    await input.fill(before === '1.00' ? '2.00' : '1.00');
    await input.press('Enter');
    await expect(page.getByRole('status')).toContainText('Bonus for Leonardo Vicentini');
    await page.goto('/settings/audit?table=work_records');
    const first = page.getByRole('row').nth(1);
    await expect(first).toContainText('Dev finance');
    await expect(first).toContainText('bonusCents');
    await expect(first).toContainText('Portal');
    // Put the sample value back so other tests keep the spec §9 totals.
    await page.goto('/hovership/week/2026-06-15');
    await page.getByRole('button', { name: 'Show days for Leonardo Vicentini' }).click();
    const again = page.getByRole('textbox', { name: /Bonus for Leonardo Vicentini/ }).first();
    await again.fill(before);
    await again.press('Enter');
    await expect(page.getByRole('status')).toContainText('Bonus for Leonardo Vicentini');
  });

  test('dispatchers have no change log', async ({ page }) => {
    await signInAs(page, 'dispatcher', '/settings/audit');
    await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible();
  });
});
