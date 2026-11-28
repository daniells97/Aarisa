import { expect, signInAs, test } from './fixtures';

// What changed for the first trial week (Nov 2026): notes and loans for anyone from the top of Daily
// operations, back from an extra job, History in Excel with extra jobs, loans and notes, and the phone menu.

test('Notes and loans at the top opens anyone’s file, even with no route that day', async ({ page }) => {
  await signInAs(page, 'dispatcher', '/hovership/today?date=2026-06-18');
  await page.getByRole('button', { name: 'Notes and loans', exact: true }).click();
  const picker = page.getByRole('dialog').getByRole('combobox');
  await expect(picker).toBeFocused();
  await picker.fill('robert');
  await page.getByRole('option', { name: /Robert Arteaga/ }).click();
  await expect(page.getByRole('dialog', { name: 'Robert Arteaga: notes and loans' })).toBeVisible();
});

test('an extra job opened from Daily operations goes back there', async ({ page }) => {
  await signInAs(page, 'dispatcher', '/tforce/today?date=2026-06-18');
  await page.getByRole('link', { name: 'Log extra job' }).first().click();
  await expect(page).toHaveURL(/extra-jobs\/new\?.*from=today/);
  await page.getByRole('link', { name: /Daily operations/ }).last().click();
  await expect(page).toHaveURL(/tforce\/today/);
});

test('History downloads an Excel file and lists the extra jobs of the period', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one device is enough');
  await signInAs(page, 'owner', '/history?period=day&date=2026-06-18');
  await expect(page.getByRole('heading', { name: 'Extra jobs' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'TF-55821' })).toBeVisible();
  const link = page.getByRole('link', { name: 'Download Excel' });
  const res = await page.request.get(await link.getAttribute('href') as string);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('spreadsheetml');
  expect(res.headers()['content-disposition']).toContain('history-2026-06-18.xlsx');
});

test('History download needs a signed-in user', async ({ request }) => {
  const res = await request.get('/history-export?from=2026-06-01&to=2026-06-30', { maxRedirects: 0 });
  expect(res.status()).toBe(401);
});

test('the phone menu reaches every screen', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the menu button is for phones');
  await signInAs(page, 'owner', '/tforce/today?date=2026-06-18');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Payroll' }).click();
  await expect(page).toHaveURL(/\/payroll/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the signed-in person and Sign out are at the top', async ({ page }) => {
  await signInAs(page, 'finance', '/');
  await expect(page.locator('.top-user .avatar')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign out' })).toBeVisible();
});

test("the × on a line takes it off the day's list, and Undo puts it back", async ({ page, isMobile }) => {
  test.skip(isMobile, 'one device is enough; it writes data');
  await signInAs(page, 'dispatcher', '/tforce/today?date=2027-05-10');
  const lines = page.locator('.today-list tbody tr');
  const before = await lines.count();
  const x = page.getByRole('button', { name: /^Take .+ off today's list$/ }).locator('visible=true').first();
  const who = (await x.getAttribute('aria-label'))!.replace(/^Take | off today's list$/g, '');
  await x.click();
  await expect(page.locator('.toasts')).toContainText(`${who} is off today's list.`);
  await expect(lines).toHaveCount(before - 1);
  await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toasts')).toContainText('Change undone.');
  await expect(lines).toHaveCount(before);
});

test('person first: Driver, Driver code, Route; Confirm and Send list are separate; a person without code gets one', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one device is enough; it writes data');
  // A fresh day each run (the list of a day stays sent once it is sent).
  const n = Date.now();
  const date = `2029-${String((n % 12) + 1).padStart(2, '0')}-${String((Math.floor(n / 12) % 28) + 1).padStart(2, '0')}`;
  await signInAs(page, 'dispatcher', `/tforce/today?date=${date}`);
  await expect(page.locator('thead th').first()).toHaveText('Driver');
  await expect(page.locator('thead th').nth(1)).toHaveText('Driver code');
  // Confirming and sending are two buttons: confirm the usual drivers, then send the list whenever.
  await page.getByRole('button', { name: /^Confirm \d+ usual drivers$/ }).click();
  await expect(page.locator('.toasts')).toContainText('confirmed');
  await page.getByRole('button', { name: 'Send list' }).click();
  await expect(page.locator('.toasts')).toContainText('List not sent: nobody is set to get it.');
  await expect(page.getByRole('button', { name: 'Send list again' })).toBeVisible();
  await page.getByRole('button', { name: 'Add record' }).first().click();
  const who = page.locator('tr.new-record').getByRole('combobox').first();
  await who.click();
  const name = `E2E Person ${n}`;
  await who.fill(name);
  await page.getByRole('option', { name: `Add “${name}” as a new driver` }).click();
  await page.getByRole('dialog', { name: 'Add driver' }).getByRole('button', { name: 'Save driver' }).click();
  await expect(page.locator('.toasts')).toContainText(`${name} is on today's list.`);
  const code = page.getByRole('combobox', { name: new RegExp(`Driver code for ${name}`) }).locator('visible=true');
  await code.click();
  await code.fill(`E2E${String(Date.now()).slice(-5)}`);
  await page.getByRole('option', { name: /New driver code/ }).click();
  await expect(page.locator('.toasts')).toContainText(`${name} now drives`);
});

test('tapping a status switches it, with Undo: drivers (Active / Inactive) and Team access (Active / Paused)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one device is enough; it writes data');
  await signInAs(page, 'owner', '/settings/rates?tab=drivers');
  await page.getByRole('button', { name: 'Adolfo Mora is active. Tap to make inactive' }).locator('visible=true').click();
  await expect(page.locator('.toasts')).toContainText('Adolfo Mora is inactive');
  await page.locator('.toasts').getByRole('button', { name: 'Undo' }).last().click();
  await expect(page.getByRole('button', { name: 'Adolfo Mora is active. Tap to make inactive' }).locator('visible=true')).toBeVisible();

  await page.goto('/settings/team');
  const pause = page.getByRole('button', { name: /Dev finance (can sign in|is paused)/ }).locator('visible=true');
  const was = await pause.getAttribute('aria-label');
  await pause.click();
  await expect(page.locator('.toasts')).toContainText('Dev finance');
  await page.locator('.toasts').getByRole('button', { name: 'Undo' }).last().click();
  await expect(page.getByRole('button', { name: was! }).locator('visible=true')).toBeVisible();
  // Nobody can pause themselves.
  await expect(page.getByRole('button', { name: /Aaron Fitzpatrick can sign in/ })).toHaveCount(0);
});
