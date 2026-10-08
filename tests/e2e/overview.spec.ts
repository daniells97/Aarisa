import { expect, signInAs, test } from './fixtures';

test('overview for the week of June 15 lists what needs the owner and the figures', async ({ page }) => {
  await signInAs(page, 'owner', '/?week=2026-06-15');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Aaron');
  const needs = page.getByRole('region', { name: 'Needs you, most urgent first' });
  await expect(needs.getByText(/Hovership payroll for June 8 to June 21/)).toBeVisible();
  await expect(needs.getByText(/day lost money/)).toBeVisible();
  await expect(page.getByText('2,553').first()).toBeVisible();
  await expect(page.getByText('$7,344.50').first()).toBeVisible();
  await expect(page.getByText('$1,222.50').first()).toBeVisible();
});

test('the phone Week tab shows the same overview without money for dispatchers', async ({ page }) => {
  await signInAs(page, 'dispatcher', '/week?week=2026-06-15');
  await expect(page.getByText('$7,344.50').first()).toBeVisible();
  await expect(page.getByText('Hovership profit')).toHaveCount(0);
  await expect(page.getByText(/lost money/)).toHaveCount(0);
});
