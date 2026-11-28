import { test as base, expect, type Page } from '@playwright/test';
import type { Role } from '../../src/domain/permissions';

/** `page.goto` that also waits for React hydration, so clicks reach real handlers. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const res = await goto(url, options);
      await page.locator('html[data-hydrated="true"]').waitFor();
      return res;
    };
    await use(page);
  },
});

/** Signs in with the development login (needs DEV_LOGIN=1 on the dev server). */
export async function signInAs(page: Page, role: Role, returnTo = '/', lang: 'en' | 'es' = 'en') {
  await page.goto(`/auth/dev?role=${role}&lang=${lang}&returnTo=${encodeURIComponent(returnTo)}`);
}

export { expect };
