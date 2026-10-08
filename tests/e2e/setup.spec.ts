import { expect, signInAs, test } from './fixtures';

test.describe('drivers and rates', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop screen');

  test('owner sees Hovership rates with margins and can open add rate', async ({ page }) => {
    await signInAs(page, 'owner', '/settings/rates');
    const row = page.getByRole('row').filter({ hasText: 'Tier 1 to 3' }).first();
    await expect(row).toContainText('$3.00');
    await expect(row).toContainText('$2.50');
    await expect(row).toContainText('$0.50');
    await expect(page.getByRole('row').filter({ hasText: 'Pharma pickup' })).toContainText('Driver rate missing');
    await page.getByRole('button', { name: 'Add rate' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Add rate' })).toBeVisible();
    await expect(page.getByLabel('Starts')).toBeVisible();
  });

  test('dispatcher sees driver pay but no client rates or margins', async ({ page }) => {
    await signInAs(page, 'dispatcher', '/settings/rates');
    await expect(page.getByText('Client rates and margins are hidden for your role.')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Client pays' })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: 'Tier 1 to 3' }).first()).toContainText('$2.50');
    await expect(page.getByText('$3.00')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add rate' })).toHaveCount(0);
  });

  test('drivers tab lists the seeded drivers and Puma', async ({ page }) => {
    await signInAs(page, 'viewer', '/settings/rates?tab=drivers');
    await expect(page.getByRole('cell', { name: /Robert Arteaga/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Puma/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add driver' })).toHaveCount(0);
  });
});

test.describe('team access', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop screen');

  test('owner sees people and the role matrix; invites wait for Zitadel', async ({ page }) => {
    await signInAs(page, 'owner', '/settings/team');
    await expect(page.getByRole('heading', { name: 'What each role can do' })).toBeVisible();
    const invite = page.getByRole('button', { name: 'Invite someone' });
    await expect(invite).toBeDisabled();
    await expect(invite).toHaveAccessibleDescription(/Zitadel/);
  });

  test('finance gets a no-access page from the server', async ({ page }) => {
    await signInAs(page, 'finance', '/settings/team');
    await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible();
  });
});
