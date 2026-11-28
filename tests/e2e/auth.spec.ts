import { expect, signInAs, test } from './fixtures';

test('signed-out visitors are sent to sign in and come back after', async ({ page }) => {
  await page.goto('/payroll');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fpayroll/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in as Finance' }).click();
  await expect(page).toHaveURL(/\/payroll$/);
});

test('dispatchers do not see money or team sections', async ({ page, isMobile }) => {
  test.skip(isMobile, 'sidebar is desktop only');
  await signInAs(page, 'dispatcher');
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  await expect(nav.getByRole('link', { name: 'Payroll' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Settlements' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Team access' })).toHaveCount(0);
});

test('language switch turns the sign-in page into Spanish', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Español' }).click();
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
