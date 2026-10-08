import { test as base, expect } from '@playwright/test';

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
export { expect };
