import { expect, signInAs, test } from './fixtures';

// Stage 6c: a client the code has never heard of, set up from the screens only.
test.describe('new client', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop screen');

  test('owner creates a client, reads a sample report to set its layout, and gets its screens in the menu', async ({ page }) => {
    await signInAs(page, 'owner', '/settings/rates?tab=clients');
    await page.getByRole('button', { name: 'New client' }).click();
    const dialog = page.getByRole('dialog', { name: 'New client' });
    await dialog.getByLabel('Name people see').fill('E2E Parcel');
    await dialog.getByLabel('First day of a pay period').fill('2027-02-01');
    await dialog.getByLabel('Client pays in (days)').fill('15');
    await dialog.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByRole('status')).toContainText('E2E Parcel created');

    const panel = page.getByRole('region', { name: 'E2E Parcel' });
    await panel.getByRole('button', { name: 'How the E2E Parcel report is read' }).click();
    const layout = page.getByRole('dialog');
    await layout.locator('input[type=file]').setInputFiles({ name: 'sample.csv', mimeType: 'text/csv', buffer: Buffer.from('Delivery Date,Route ID,Packages,Comments\n2027-02-01,BP-01,132,\n') });
    await expect(layout).toContainText('4 columns read from sample.csv');
    await expect(layout.getByLabel('What Delivery Date is')).toHaveValue('work_date');
    await expect(layout.getByLabel('What Route ID is')).toHaveValue('route_code');
    await expect(layout.getByLabel('What Packages is')).toHaveValue('quantity');
    await layout.getByLabel('Service name').fill('Package');
    await layout.getByRole('button', { name: 'Save layout' }).click();
    await expect(page.getByRole('status')).toContainText('Layout saved');

    await page.reload();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: "Today's drivers" }).last().click();
    await expect(page).toHaveURL(/op=e2e_parcel/);
    await expect(page.getByText("E2E Parcel's report next Monday")).toBeVisible();
  });
});
