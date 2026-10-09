import { expect, signInAs, test } from './fixtures';

test.describe('services and rates', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop screen');

  test('owner adds an extra-job service and it shows in the extra job form', async ({ page }) => {
    const name = `Test service ${Date.now()}`;
    await signInAs(page, 'owner', '/settings/rates?tab=services');
    await page.getByRole('button', { name: 'Add service' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add service' });
    await dialog.getByLabel('Name in English').fill(name);
    await dialog.getByLabel('Name in Spanish').fill(`Servicio ${name}`);
    await dialog.getByRole('button', { name: 'Save service' }).click();
    await expect(page.getByRole('status')).toContainText('Service saved.');
    await expect(page.getByRole('cell', { name: new RegExp(name) }).first()).toBeVisible();

    await page.goto('/extra-jobs/new');
    await expect(page.getByRole('button', { name })).toBeVisible();

    // turn it off again so the form stays clean for the next run
    await page.goto('/settings/rates?tab=services');
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await page.getByLabel('Can be chosen for new jobs').uncheck();
    await page.getByRole('button', { name: 'Save service' }).click();
    await expect(page.getByRole('status')).toContainText('Service saved.');
  });

  test('changing a rate opens with the current amounts and explains the start date', async ({ page }) => {
    await signInAs(page, 'owner', '/settings/rates');
    await page.getByRole('button', { name: /Change rate for Tier 1 to 3/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Client pays')).toHaveValue('3.00');
    await expect(dialog.getByLabel('Driver gets')).toHaveValue('2.50');
    await expect(dialog).toContainText('stays on the weeks before your new start date');
  });

  test('report services cannot be turned off', async ({ page }) => {
    await signInAs(page, 'owner', '/settings/rates?tab=services');
    await page.getByRole('button', { name: 'Edit Stat stop' }).click();
    await expect(page.getByRole('dialog')).toContainText("This service comes from the client's report");
    await expect(page.getByLabel('Can be chosen for new jobs')).toHaveCount(0);
  });
});
