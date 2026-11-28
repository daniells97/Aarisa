import { expect, signInAs, test } from './fixtures';

test('June 18 lists the two sample jobs; the owner sees what is missing', async ({ page }) => {
  await signInAs(page, 'owner', '/extra-jobs?date=2026-06-18');
  const recovery = page.getByRole('listitem').filter({ hasText: 'TF-55821' });
  await expect(recovery).toContainText('Recovery route');
  await expect(recovery).toContainText('$180.00');
  const grainger = page.getByRole('listitem').filter({ hasText: 'Grainger' });
  await expect(grainger).toContainText('Saved without what T-Force pays');
  await expect(grainger.getByRole('button', { name: 'Add what T-Force pays' })).toBeVisible();
});

test('a dispatcher never sees what T-Force pays', async ({ page }) => {
  await signInAs(page, 'dispatcher', '/extra-jobs?date=2026-06-18');
  await expect(page.getByText('$180.00')).toHaveCount(0);
  await expect(page.getByText('Saved without what T-Force pays')).toHaveCount(0);
  await page.getByRole('link', { name: 'Log extra job' }).click();
  await expect(page.getByLabel('T-Force pays')).toHaveCount(0);
  await expect(page.getByText('Finance or the owner adds what T-Force pays.')).toBeVisible();
});

test('a dispatcher logs a pickup from the phone form', async ({ page }) => {
  await signInAs(page, 'dispatcher', '/extra-jobs/new?date=2026-09-02');
  await page.getByRole('button', { name: 'Pickup' }).click();
  await expect(page.getByRole('button', { name: 'Pickup' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Done by').selectOption({ label: 'Marcus Dub' });
  await page.getByLabel('Marcus Dub gets').fill('35');
  await page.getByLabel('T-Force order number').fill(`TF-E2E-${Date.now()}`);
  await page.getByRole('button', { name: 'Save extra job' }).click();
  await expect(page.getByRole('status')).toContainText('Extra job saved.');
  await expect(page).toHaveURL(/\/extra-jobs\?date=2026-09-02/);
  await expect(page.getByRole('listitem').filter({ hasText: 'Marcus Dub' }).first()).toContainText('$35.00');
});
