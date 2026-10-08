import { expect, test } from './fixtures';

test('shell shows the sidebar on desktop and the tab bar on phones', async ({ page, isMobile }) => {
  await page.goto('/styleguide');
  await expect(page.getByRole('heading', { name: 'Components', level: 1 })).toBeVisible();
  const navs = page.getByRole('navigation', { name: 'Main' });
  if (isMobile) {
    await expect(navs.getByRole('link', { name: 'Extra jobs' })).toBeVisible();
    const box = await navs.getByRole('link', { name: 'Today' }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  } else {
    await expect(navs.getByRole('link', { name: 'Drivers and rates' })).toBeVisible();
  }
});

test('toast offers undo and a disabled button explains why', async ({ page }) => {
  await page.goto('/styleguide');
  await page.getByRole('button', { name: 'Show a toast' }).click();
  await expect(page.getByRole('status')).toContainText('Route 9000E changed');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('status')).toContainText('Change undone');
  const approve = page.getByRole('button', { name: 'Approve $13,389.00' });
  await expect(approve).toBeDisabled();
  await expect(approve).toHaveAccessibleDescription(/3 open exceptions/);
});

test('dialog closes with Escape', async ({ page }) => {
  await page.goto('/styleguide');
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Approve payroll' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});
