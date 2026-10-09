import { expect, signInAs, test } from './fixtures';

test("June 18 shows the sample list and the unknown name on 9000Z", async ({ page }) => {
  await signInAs(page, 'dispatcher', '/tforce/today?date=2026-06-18');
  await expect(page.getByRole('heading', { name: "Today's drivers" })).toBeVisible();
  await expect(page.getByText('Who drove 9000Z?')).toBeVisible();
  await expect(page.getByText('the new guy from Puma').locator('visible=true').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add under Puma' })).toBeVisible();
});

test('a dispatcher types a name to change a route, sees the toast and undoes it', async ({ page }) => {
  await signInAs(page, 'dispatcher', '/tforce/today?date=2027-01-04');
  const picker = page.getByRole('combobox', { name: /Driver for 9000A on/ }).locator('visible=true');
  const before = await picker.getAttribute('placeholder');
  await picker.click();
  await picker.fill('norwin');
  await page.getByRole('option', { name: 'Norwin Saloman' }).click();
  await expect(page.getByRole('status')).toContainText('9000A is now Norwin Saloman.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('status')).toContainText('Change undone.');
  await expect(picker).toHaveAttribute('placeholder', before!);
});

test('a name that is not on the list can be added right from the picker', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one device is enough; it writes data');
  const name = `E2E Driver ${Date.now()}`;
  await signInAs(page, 'dispatcher', '/tforce/today?date=2027-01-05');
  const picker = page.getByRole('combobox', { name: /Driver for 9000B on/ }).locator('visible=true');
  await picker.click();
  await picker.fill(name);
  await page.getByRole('option', { name: `Add “${name}” as a new driver` }).click();
  await expect(page.getByRole('status')).toContainText(`${name} added as a new driver and assigned to 9000B.`);
  await expect(picker).toHaveAttribute('placeholder', name);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('status')).toContainText('Change undone.');
});

test('add a route with its driver from the same screen', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one device is enough; it writes data');
  const code = `E2E${String(Date.now()).slice(-5)}`;
  await signInAs(page, 'owner', '/tforce/today?date=2027-01-05');
  await page.getByRole('button', { name: 'Add route' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Route code').fill(code);
  const who = dialog.getByRole('combobox', { name: 'Who drives it' });
  await who.click();
  await who.fill('Diana');
  await page.getByRole('option', { name: 'Diana Arvelo' }).click();
  await dialog.getByRole('button', { name: 'Add route' }).click();
  await expect(page.getByRole('status')).toContainText(`Route ${code} added with Diana Arvelo.`);
  await expect(page.getByText(code, { exact: true }).locator('visible=true').first()).toBeVisible();
});

test('finance sees the list but cannot change it', async ({ page }) => {
  await signInAs(page, 'finance', '/tforce/today?date=2026-06-18');
  await expect(page.getByText("You can see the list; dispatchers and the owner change it.")).toBeVisible();
  await expect(page.getByRole('combobox', { name: /Driver for 9000A on/ }).locator('visible=true')).toBeDisabled();
});
