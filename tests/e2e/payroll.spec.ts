import { expect, signInAs, test } from './fixtures';

// Uses the seeded June sample. Approves the June 8 to 21 run, then reopens it so the test can run again.
test.describe('payroll', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop screen');
  test.describe.configure({ mode: 'serial' });

  test('runs list shows the June 8 to 21 Hovership run with its total', async ({ page }) => {
    await signInAs(page, 'owner', '/payroll');
    const row = page.getByRole('listitem').filter({ hasText: 'June 8 to June 21' });
    await expect(row).toContainText('$13,389.00');
  });

  test('finance can export but not approve', async ({ page }) => {
    await signInAs(page, 'finance', '/payroll/hovership-2026-06-08');
    const approve = page.getByRole('button', { name: 'Review and approve' });
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAccessibleDescription('Only the owner approves payroll.');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: /Export/ }).click();
    expect((await download).suggestedFilename()).toMatch(/^aarisa-hovership-payroll-2026-06-08(-draft)?\.csv$/);
  });

  test('owner approves with the exact amount, the run locks, then reopens it', async ({ page }) => {
    await signInAs(page, 'owner', '/payroll/hovership-2026-06-08');
    await page.getByRole('button', { name: 'Review and approve' }).click();
    const dialog = page.getByRole('dialog', { name: 'Approve this payroll?' });
    await expect(dialog).toContainText('Every driver code recognised');
    await dialog.getByRole('button', { name: 'Approve $13,389.00' }).click();
    await expect(page.getByRole('status')).toContainText('Payroll approved: $13,389.00.');
    await expect(page.getByText('This run is locked.')).toBeVisible();
    await page.goto('/hovership/week/2026-06-15');
    await expect(page.getByText('This pay period is approved and locked.')).toBeVisible();
    await page.goto('/payroll/hovership-2026-06-08');
    await page.getByRole('button', { name: 'Reopen run' }).click();
    await expect(page.getByText('Reopened', { exact: true })).toBeVisible();
  });

  test('dispatcher sees what drivers get but not the profit', async ({ page }) => {
    await signInAs(page, 'dispatcher', '/payroll/hovership-2026-06-08');
    await expect(page.getByText('$13,389.00').first()).toBeVisible();
    await expect(page.getByText('Profit')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Export/ })).toHaveCount(0);
  });
});
