import { existsSync } from 'node:fs';
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Tests use their own database (aarisa_test, .env.test) when it exists, never the test environment's aarisa_dev.
if (existsSync('.env.test')) config({ path: '.env.test', override: true });
config();
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    // Database tests run against aarisa_test; each runs in a rolled-back transaction.
    fileParallelism: false,
    // Some database tests build a whole payroll; on a busy server they can pass 5 s.
    testTimeout: 15_000,
  },
});
