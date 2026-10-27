import { expect, signInAs, test } from './fixtures';

test.describe('T-Force payroll', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop screen');

  test('the weekly run waits for the exceptions and the e-commerce rate, and pays Puma as one party', async ({ page }) => {
    await signInAs(page, 'owner', '/payroll');
    await expect(page.getByRole('listitem').filter({ hasText: 'T-Force' }).filter({ hasText: 'June 15 to June 21' })).toContainText('Not ready');
    await page.goto('/payroll/tforce-2026-06-15');
    await expect(page.getByRole('heading', { name: 'T-Force, June 15 to June 21' })).toBeVisible();
    const approve = page.getByRole('button', { name: 'Review and approve' });
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAccessibleDescription(/3 open exceptions to clear/);
    await expect(page.getByText('Money shows once the T-Force e-commerce rate is added')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Puma' })).toContainText('685');
    await expect(page.getByRole('columnheader', { name: 'Bonuses' })).toHaveCount(0);
  });
});
