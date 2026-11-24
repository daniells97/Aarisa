import { expect, signInAs, test } from './fixtures';

test("June 18 shows the sample list and the unknown name on 9000Z", async ({ page }) => {
  await signInAs(page, 'dispatcher', '/tforce/today?date=2026-06-18');
  await expect(page.getByRole('heading', { name: 'Daily operations' })).toBeVisible();
  await expect(page.getByText('Who drove 9000Z?')).toBeVisible();
  await expect(page.getByText('the new guy from Puma').locator('visible=true').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add under Puma' })).toBeVisible();
});

test('a dispatcher types a name to change a route, sees the toast and undoes it', async ({ page }) => {
  await signInAs(page, 'dispatcher', '/tforce/today?date=2027-01-04');
  const picker = page.getByRole('combobox', { name: /Person for 9000A on/ }).locator('visible=true');
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
  const picker = page.getByRole('combobox', { name: /Person for 9000B on/ }).locator('visible=true');
  await picker.click();
  await picker.fill(name);
  await page.getByRole('option', { name: `Add “${name}” as a new driver` }).click();
  await expect(page.getByRole('status')).toContainText(`${name} added as a new driver and assigned to 9000B.`);
  await expect(picker).toHaveAttribute('placeholder', name);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('status')).toContainText('Change undone.');
});

test('add a record (driver code, who drives it) as a new line in the list; it saves by itself', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one device is enough; it writes data');
  const code = `E2E${String(Date.now()).slice(-5)}`;
  await signInAs(page, 'owner', '/tforce/today?date=2027-01-05');
  await page.getByRole('button', { name: 'Add record' }).first().click();
  const line = page.locator('tr.new-record');
  const codePicker = line.getByRole('combobox').first();
  await codePicker.click();
  await codePicker.fill(code);
  await page.getByRole('option', { name: `+ New driver “${code}”` }).click();
  const who = line.getByRole('combobox').nth(1);
  await who.click();
  await who.fill('Diana');
  await page.getByRole('option', { name: 'Diana Arvelo' }).click();
  await expect(page.locator('.toasts')).toContainText(`${code} saved with Diana Arvelo.`);
  await expect(page.getByText(code, { exact: true }).locator('visible=true').first()).toBeVisible();
});

test('finance sees the list but cannot change it', async ({ page }) => {
  await signInAs(page, 'finance', '/tforce/today?date=2026-06-18');
  await expect(page.getByText("You can see the list; operators and the admin change it.")).toBeVisible();
  await expect(page.getByRole('combobox', { name: /Person for 9000A on/ }).locator('visible=true')).toBeDisabled();
});

test("each person's notes and loans, and an extra job for them, open from the daily list", async ({ page }) => {
  await signInAs(page, 'dispatcher', '/tforce/today?date=2026-06-18');
  await page.getByRole('button', { name: 'Notes and loans of Robert Arteaga' }).locator('visible=true').first().click();
  await expect(page.getByRole('dialog', { name: 'Robert Arteaga: notes and loans' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Log an extra job for Robert Arteaga' }).locator('visible=true').first().click();
  await expect(page).toHaveURL(/extra-jobs\/new\?.*payee=d%3A/);
});

test('Hovership tab shows each person with a status, like T-Force', async ({ page }) => {
  await signInAs(page, 'viewer', '/hovership/today?date=2026-06-18');
  await expect(page.getByRole('tab', { name: 'Hovership' }).or(page.getByRole('link', { name: 'Hovership', exact: true })).first()).toBeVisible();
  await expect(page.getByText('No usual routes', { exact: true }).locator('visible=true').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /^Log an extra job for/ })).toHaveCount(0);
});
