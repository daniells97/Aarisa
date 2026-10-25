import { expect, signInAs, test } from './fixtures';

// Read-only checks on the seeded June 15 to 20 week; resolutions are covered by database tests.
test.describe('weekly check', () => {
  test('desktop: spec §9 totals, three flagged cells and approval waits', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop screen');
    await signInAs(page, 'finance', '/tforce/week/2026-06-15');
    await expect(page.getByText('4,910').first()).toBeVisible();
    await expect(page.getByText('71 of 74')).toBeVisible();
    await expect(page.getByText('Ready to pay')).toBeVisible();
    const total = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Total' }) });
    for (const n of ['1,112', '870', '774', '796', '740', '618']) await expect(total).toContainText(n);
    await expect(page.getByRole('table').getByText('(needs a look)')).toHaveCount(3);
    const approve = page.getByRole('button', { name: 'Approve for payroll' });
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAccessibleDescription('Clear the 3 exceptions to approve.');
    await expect(page.getByText('Thursday, 1 piece', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Assign driver' }).click();
    await expect(page.getByLabel(/Driver for 9000Z on/)).toBeVisible();
  });

  test('phone Exceptions tab lists the three exceptions with their actions', async ({ page }) => {
    await signInAs(page, 'dispatcher', '/exceptions');
    await expect(page.getByRole('listitem').filter({ hasText: '9000W' })).toContainText('Karandeep Kaur drove it');
    await expect(page.getByRole('listitem').filter({ hasText: 'the new guy from Puma' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask T-Force' })).toHaveCount(2);
  });

  test('Ask T-Force opens a claim form; what the driver is paid is never preset, and only the owner can pay more', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop screen');
    await signInAs(page, 'owner', '/tforce/week/2026-06-15');
    const card = page.locator('li.ex-card', { hasText: '9000W' });
    await card.getByRole('button', { name: 'Ask T-Force' }).click();
    await expect(card.getByLabel('Pieces you claim')).toHaveValue(/^\d+$/);
    await card.getByLabel('Amount you claim ($)').fill('175.00');
    const radios = card.getByRole('radio');
    await expect(radios).toHaveCount(2);
    for (const r of await radios.all()) await expect(r).not.toBeChecked();
    await card.getByRole('button', { name: 'Open the claim' }).click();
    await expect(card.getByRole('alert')).toHaveText('Choose what the driver is paid.');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card.getByRole('button', { name: 'Pay another amount' })).toBeVisible();

    await signInAs(page, 'dispatcher', '/tforce/week/2026-06-15');
    const asDispatcher = page.locator('li.ex-card', { hasText: '9000W' });
    await expect(asDispatcher.getByRole('button', { name: 'Pay another amount' })).toHaveCount(0);
    await asDispatcher.getByRole('button', { name: 'Ask T-Force' }).click();
    await expect(asDispatcher.getByText("Paying a driver more than the report is the owner's decision.")).toBeVisible();
    await expect(asDispatcher.getByLabel('Amount you claim ($)')).toHaveCount(0); // no client rates for dispatchers
  });

  test('viewers see exceptions but no actions', async ({ page }) => {
    await signInAs(page, 'viewer', '/exceptions');
    await expect(page.getByText('Thursday, no driver')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Assign driver' })).toHaveCount(0);
  });
});
