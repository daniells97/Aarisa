import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  globalTeardown: './tests/e2e/global-teardown.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  // Its own server on 3200 against the test database (scripts/e2e.sh starts it), so the runs never touch aarisa_dev.
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3200' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
