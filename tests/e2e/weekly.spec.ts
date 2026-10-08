import { expect, signInAs, test } from './fixtures';

// Read-only checks on the seeded June 15 to 20 week; resolutions are covered by database tests.
test.describe('weekly check', () => {
  test('desktop: spec §9 totals, three flagged cells and approval waits', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop screen');
    await signInAs(page, 'finance', '/tforce/week/2026-06-15');
    await expect(page.getByText('4,910').first()).toBeVisible();
    await expect(page.getByText('71 of 74')).toBeVisible();
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

  test('viewers see exceptions but no actions', async ({ page }) => {
    await signInAs(page, 'viewer', '/exceptions');
    await expect(page.getByText('Thursday, no driver')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Assign driver' })).toHaveCount(0);
  });
});
