import { expect, signInAs, test } from './fixtures';

// Runs against the dev database seeded with `pnpm db:seed` (June 2026 Hovership sample).
test.describe('Hovership weekly report', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop screen');

  test('week of June 15 shows spec §9 totals to finance', async ({ page }) => {
    await signInAs(page, 'finance', '/hovership/week/2026-06-15');
    await expect(page.getByRole('heading', { name: 'Hovership weekly report' })).toBeVisible();
    await expect(page.getByText('Second week of the June 8 pay period')).toBeVisible();
    await expect(page.getByRole('heading', { name: '51 rows, all 17 driver codes recognised' })).toBeVisible();
    const total = page.getByRole('row').filter({ hasText: /^Total/ });
    await expect(total).toContainText('2,496');
    await expect(total).toContainText('$909.75');
    await expect(total).toContainText('$7,344.50');
    await expect(total).toContainText('$447.50');
    await expect(page.getByText('$1,222.50')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lost money' })).toBeVisible();
  });

  test('bonus is typed per day and can be undone', async ({ page }) => {
    await signInAs(page, 'finance', '/hovership/week/2026-06-15');
    await page.getByRole('button', { name: 'Show days for Robert Arteaga' }).click();
    const input = page.getByRole('textbox', { name: /Bonus for Robert Arteaga on June 1[5-9]|Bonus for Robert Arteaga on June 2[01]/ }).first();
    const before = await input.inputValue();
    await input.fill('99.00');
    await input.press('Enter');
    await expect(page.getByRole('status')).toContainText('$99.00');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(input).toHaveValue(before);
  });

  test('dispatcher sees driver pay but no profit or margins', async ({ page }) => {
    await signInAs(page, 'dispatcher', '/hovership/week/2026-06-15');
    await expect(page.getByText('Owed to drivers')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Margin' })).toHaveCount(0);
    await expect(page.getByText('$1,222.50')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Lost money' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Upload a report' })).toHaveCount(0);
  });

  test('a week without a report shows the waiting state', async ({ page }) => {
    await signInAs(page, 'owner', '/hovership/week/2026-09-28');
    await expect(page.getByRole('heading', { name: /hasn't arrived/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload it yourself' })).toBeVisible();
  });

  test('a renamed column stops the import and nothing is saved', async ({ page }) => {
    await signInAs(page, 'owner', '/hovership/week/2026-09-28');
    await page.locator('input[type=file]').setInputFiles({
      name: 'renamed.csv', mimeType: 'text/csv',
      buffer: Buffer.from(`POD Date,Driver #,Tier 1,Tier 2,Tier 3,Tier 4,Stat,Stem,Bonus\n2026-09-28,DUB061,1,0,0,0,0,0,0\n# ${Date.now()}\n`),
    });
    await expect(page.getByRole('heading', { name: "This report isn't laid out like last week's" })).toBeVisible();
    await expect(page.getByText('Nothing was saved.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use Driver # and continue' })).toBeVisible();
  });
});
