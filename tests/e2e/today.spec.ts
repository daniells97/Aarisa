import { expect, signInAs, test } from './fixtures';

test("June 18 shows the sample list and the unknown name on 9000Z", async ({ page }) => {
  await signInAs(page, 'dispatcher', '/tforce/today?date=2026-06-18');
  await expect(page.getByRole('heading', { name: "Today's drivers" })).toBeVisible();
  await expect(page.getByText('Who drove 9000Z?')).toBeVisible();
  await expect(page.getByText('the new guy from Puma').locator('visible=true').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add under Puma' })).toBeVisible();
});

test('a dispatcher changes a route, sees the toast and undoes it', async ({ page }) => {
  await signInAs(page, 'dispatcher', '/tforce/today?date=2026-09-03');
  const select = page.getByRole('combobox', { name: /Driver for 9000A on/ }).locator('visible=true');
  const before = await select.inputValue();
  await select.selectOption({ label: 'Norwin Saloman' });
  await expect(page.getByRole('status')).toContainText('9000A is now Norwin Saloman.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('status')).toContainText('Change undone.');
  await expect(select).toHaveValue(before);
});

test('finance sees the list but cannot change it', async ({ page }) => {
  await signInAs(page, 'finance', '/tforce/today?date=2026-06-18');
  await expect(page.getByText("You can see the list; dispatchers and the owner change it.")).toBeVisible();
  await expect(page.getByRole('combobox', { name: /Driver for 9000A on/ }).locator('visible=true')).toBeDisabled();
});
