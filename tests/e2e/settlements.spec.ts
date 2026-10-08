import { expect, signInAs, test } from './fixtures';

test.describe('settlements', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop screen');

  test('finance sees paid and late Hovership weeks and the recovery-route claim', async ({ page }) => {
    await signInAs(page, 'finance', '/settlements?client=hovership');
    const paid = page.getByRole('row').filter({ hasText: 'Week ending Jun 7' });
    await expect(paid).toContainText('Paid');
    const jun21 = page.getByRole('row').filter({ hasText: 'Week ending Jun 21' });
    await expect(jun21).toContainText('$8,567.00');
    await expect(jun21).toContainText('days late');
    await page.goto('/settlements?client=tforce');
    await page.getByRole('link', { name: /Open claim for Recovery route/ }).click();
    const claim = page.getByRole('region', { name: 'Claim for T-Force' });
    await expect(claim).toContainText('TF-55821');
    await expect(claim).toContainText('Order number attached');
    await expect(claim.getByRole('link', { name: 'Email claim to T-Force' })).toHaveAttribute('href', /^mailto:\?subject=Aarisa%20claim/);
    await claim.getByRole('link', { name: 'Download PDF' }).click();
    await expect(page.getByRole('heading', { name: 'Claim for a missing adjustment' })).toBeVisible();
  });

  test('the payment dialog refuses lines that add up to more than the payment', async ({ page }) => {
    await signInAs(page, 'owner', '/settlements?client=hovership');
    await page.getByRole('button', { name: 'Record payment' }).click();
    const dialog = page.getByRole('dialog', { name: 'Record a payment' });
    await dialog.getByLabel('Amount', { exact: true }).fill('100');
    await dialog.getByRole('checkbox').first().check();
    await expect(dialog.getByRole('alert')).toContainText('The lines add up to more than the payment.');
    await expect(dialog.getByRole('button', { name: /Save payment of/ })).toBeDisabled();
  });

  test('viewers read settlements; dispatchers have no access', async ({ page }) => {
    await signInAs(page, 'viewer', '/settlements');
    await expect(page.getByText('You can see settlements; finance and the owner record payments and claims.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
    await signInAs(page, 'dispatcher', '/settlements');
    await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible();
  });
});
