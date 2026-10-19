import { expect, signInAs, test } from './fixtures';

test.describe('drivers and rates', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop screen');

  test('owner sees Hovership rates with margins and can open add rate', async ({ page }) => {
    await signInAs(page, 'owner', '/settings/rates');
    const row = page.getByRole('row').filter({ hasText: 'Tier 2' }).first();
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
    await expect(page.getByRole('row').filter({ hasText: 'Tier 2' }).first()).toContainText('$2.50');
    await expect(page.getByText('$3.00')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add rate' })).toHaveCount(0);
  });

  test('clients tab shows each contract with the rules it runs with', async ({ page }) => {
    await signInAs(page, 'owner', '/settings/rates?tab=clients');
    const tforce = page.getByRole('region', { name: 'T-Force' });
    await expect(tforce.getByRole('row').filter({ hasText: 'T-Force' })).toContainText("Aarisa's daily list");
    await expect(tforce.getByRole('row').filter({ hasText: 'T-Force' })).toContainText('30 days');
    await tforce.getByRole('button', { name: 'Rules for T-Force' }).click();
    await expect(page.getByRole('dialog')).toContainText('The driver comes from');
    await expect(page.getByLabel('Low pieces under (% of usual)')).toHaveValue('10');
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
